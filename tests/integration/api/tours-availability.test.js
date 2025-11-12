/**
 * Tours Availability Integration Tests
 * Tests tour creation and updates with availability fields (days, start/end times)
 */

const request = require('supertest');
const Parse = require('parse/node');
const AuthTestHelper = require('../../helpers/authTestHelper');

describe('Tours Availability Integration Tests', () => {
  let app;
  let superadminToken;
  let testPOI;
  let testVehicleType;
  let testRate;

  beforeAll(async () => {
    // Import app (Parse Server already running on 1339)
    app = require('../../../src/index');

    // Wait for app initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Login with seeded users
    superadminToken = await AuthTestHelper.loginAs('superadmin', app);

    // Create test dependencies
    const POI = Parse.Object.extend('POI');
    testPOI = new POI();
    testPOI.set('name', 'Test Tour POI');
    testPOI.set('latitude', 20.123);
    testPOI.set('longitude', -103.456);
    testPOI.set('category', 'Atracción');
    testPOI.set('active', true);
    testPOI.set('exists', true);
    await testPOI.save(null, { useMasterKey: true });

    const VehicleType = Parse.Object.extend('VehicleType');
    testVehicleType = new VehicleType();
    testVehicleType.set('name', 'Test Vehicle Type');
    testVehicleType.set('maxCapacity', 8);
    testVehicleType.set('active', true);
    testVehicleType.set('exists', true);
    await testVehicleType.save(null, { useMasterKey: true });

    const Rate = Parse.Object.extend('Rate');
    testRate = new Rate();
    testRate.set('name', 'Test Rate');
    testRate.set('pricePerKm', 15);
    testRate.set('pricePerHour', 200);
    testRate.set('active', true);
    testRate.set('exists', true);
    await testRate.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    // Clean up test dependencies
    if (testPOI) {
      await testPOI.destroy({ useMasterKey: true });
    }
    if (testVehicleType) {
      await testVehicleType.destroy({ useMasterKey: true });
    }
    if (testRate) {
      await testRate.destroy({ useMasterKey: true });
    }
  });

  describe('POST /api/tours - Create tour with availability', () => {
    it('should create a tour with valid availability fields', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240, // 4 hours
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availableDays: [1, 2, 4, 0], // Monday, Tuesday, Thursday, Sunday
        startTime: '13:30',
        endTime: '17:30',
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tour.id).toBeDefined();

      // Verify tour was created with availability fields
      const query = new Parse.Query('Tours');
      const tour = await query.get(response.body.data.tour.id, { useMasterKey: true });

      expect(tour.get('availableDays')).toEqual([1, 2, 4, 0]); // Should be sorted chronologically
      expect(tour.get('startTime')).toBe('13:30');
      expect(tour.get('endTime')).toBe('17:30');

      // Clean up
      await tour.destroy({ useMasterKey: true });
    });

    it('should create a tour without availability fields (optional)', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 120,
        vehicleType: testVehicleType.id,
        price: 1000,
        rate: testRate.id,
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      // Verify tour was created without availability fields
      const query = new Parse.Query('Tours');
      const tour = await query.get(response.body.data.tour.id, { useMasterKey: true });

      expect(tour.get('availableDays')).toBeUndefined();
      expect(tour.get('startTime')).toBeUndefined();
      expect(tour.get('endTime')).toBeUndefined();

      // Clean up
      await tour.destroy({ useMasterKey: true });
    });

    it('should reject tour with invalid day codes', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availableDays: [1, 2, 7, 8], // Invalid: 7 and 8
        startTime: '13:30',
        endTime: '17:30',
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Datos de disponibilidad inválidos');
    });

    it('should reject tour with invalid time format', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availableDays: [1, 2, 4],
        startTime: '25:00', // Invalid: hour > 23
        endTime: '17:30',
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Datos de disponibilidad inválidos');
    });

    it('should reject tour with endTime before startTime', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availableDays: [1, 2, 4],
        startTime: '17:30',
        endTime: '13:30', // Invalid: before startTime
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('endTime must be after startTime');
    });

    it('should reject tour with empty availableDays array', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availableDays: [], // Invalid: empty
        startTime: '13:30',
        endTime: '17:30',
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('At least one day must be selected');
    });

    it('should reject tour with partial availability data', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availableDays: [1, 2, 4],
        startTime: '13:30',
        // Missing endTime
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Para configurar disponibilidad, debe proporcionar días disponibles, hora de inicio y hora de fin');
    });

    it('should sort day codes chronologically', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availableDays: [0, 4, 1, 2], // Unsorted: Sunday, Thursday, Monday, Tuesday
        startTime: '13:30',
        endTime: '17:30',
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      // Verify tour has sorted day codes (Monday first, Sunday last)
      const query = new Parse.Query('Tours');
      const tour = await query.get(response.body.data.tour.id, { useMasterKey: true });

      expect(tour.get('availableDays')).toEqual([1, 2, 4, 0]); // Monday, Tuesday, Thursday, Sunday

      // Clean up
      await tour.destroy({ useMasterKey: true });
    });
  });

  describe('PUT /api/tours/:id - Update tour availability', () => {
    let testTour;

    beforeEach(async () => {
      // Create a test tour
      const Tour = Parse.Object.extend('Tours');
      testTour = new Tour();
      testTour.set('destinationPOI', testPOI);
      testTour.set('time', 180);
      testTour.set('vehicleType', testVehicleType);
      testTour.set('price', 1200);
      testTour.set('rate', testRate);
      testTour.set('active', true);
      testTour.set('exists', true);
      await testTour.save(null, { useMasterKey: true });
    });

    afterEach(async () => {
      if (testTour) {
        await testTour.destroy({ useMasterKey: true });
      }
    });

    it('should update tour with availability fields', async () => {
      const updateData = {
        destinationPOI: testPOI.id,
        time: 180,
        vehicleType: testVehicleType.id,
        price: 1200,
        rate: testRate.id,
        availableDays: [1, 3, 5], // Monday, Wednesday, Friday
        startTime: '09:00',
        endTime: '18:00',
      };

      const response = await request(app)
        .put(`/api/tours/${testTour.id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify tour was updated
      await testTour.fetch({ useMasterKey: true });
      expect(testTour.get('availableDays')).toEqual([1, 3, 5]);
      expect(testTour.get('startTime')).toBe('09:00');
      expect(testTour.get('endTime')).toBe('18:00');
    });

    it('should remove availability fields when set to null', async () => {
      // First add availability
      testTour.set('availableDays', [1, 2, 4]);
      testTour.set('startTime', '13:30');
      testTour.set('endTime', '17:30');
      await testTour.save(null, { useMasterKey: true });

      // Now remove availability
      const updateData = {
        destinationPOI: testPOI.id,
        time: 180,
        vehicleType: testVehicleType.id,
        price: 1200,
        rate: testRate.id,
        availableDays: null,
        startTime: null,
        endTime: null,
      };

      const response = await request(app)
        .put(`/api/tours/${testTour.id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify availability fields were removed
      await testTour.fetch({ useMasterKey: true });
      expect(testTour.get('availableDays')).toBeUndefined();
      expect(testTour.get('startTime')).toBeUndefined();
      expect(testTour.get('endTime')).toBeUndefined();
    });
  });

  describe('GET /api/tours/:id - Get tour with availability', () => {
    let testTour;

    beforeAll(async () => {
      // Create a test tour with availability
      const Tour = Parse.Object.extend('Tours');
      testTour = new Tour();
      testTour.set('destinationPOI', testPOI);
      testTour.set('time', 240);
      testTour.set('vehicleType', testVehicleType);
      testTour.set('price', 1500);
      testTour.set('rate', testRate);
      testTour.set('availableDays', [1, 2, 4, 0]);
      testTour.set('startTime', '13:30');
      testTour.set('endTime', '17:30');
      testTour.set('active', true);
      testTour.set('exists', true);
      await testTour.save(null, { useMasterKey: true });
    });

    afterAll(async () => {
      if (testTour) {
        await testTour.destroy({ useMasterKey: true });
      }
    });

    it('should return tour with availability fields', async () => {
      const response = await request(app)
        .get(`/api/tours/${testTour.id}`)
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tour.availableDays).toEqual([1, 2, 4, 0]);
      expect(response.body.data.tour.startTime).toBe('13:30');
      expect(response.body.data.tour.endTime).toBe('17:30');
    });
  });

  describe('GET /api/tours - List tours with availability', () => {
    let testTour1;
    let testTour2;

    beforeAll(async () => {
      // Create test tours
      const Tour = Parse.Object.extend('Tours');

      testTour1 = new Tour();
      testTour1.set('destinationPOI', testPOI);
      testTour1.set('time', 240);
      testTour1.set('vehicleType', testVehicleType);
      testTour1.set('price', 1500);
      testTour1.set('rate', testRate);
      testTour1.set('availableDays', [1, 2, 4]);
      testTour1.set('startTime', '13:30');
      testTour1.set('endTime', '17:30');
      testTour1.set('active', true);
      testTour1.set('exists', true);
      await testTour1.save(null, { useMasterKey: true });

      testTour2 = new Tour();
      testTour2.set('destinationPOI', testPOI);
      testTour2.set('time', 180);
      testTour2.set('vehicleType', testVehicleType);
      testTour2.set('price', 1200);
      testTour2.set('rate', testRate);
      // No availability fields
      testTour2.set('active', true);
      testTour2.set('exists', true);
      await testTour2.save(null, { useMasterKey: true });
    });

    afterAll(async () => {
      if (testTour1) {
        await testTour1.destroy({ useMasterKey: true });
      }
      if (testTour2) {
        await testTour2.destroy({ useMasterKey: true });
      }
    });

    it('should return tours with and without availability fields', async () => {
      const response = await request(app)
        .get('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .query({ draw: 1, start: 0, length: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);

      // Find our test tours
      const tour1 = response.body.data.find((t) => t.id === testTour1.id);
      const tour2 = response.body.data.find((t) => t.id === testTour2.id);

      expect(tour1).toBeDefined();
      expect(tour1.availableDays).toEqual([1, 2, 4]);
      expect(tour1.startTime).toBe('13:30');
      expect(tour1.endTime).toBe('17:30');

      expect(tour2).toBeDefined();
      expect(tour2.availableDays).toBeNull();
      expect(tour2.startTime).toBeNull();
      expect(tour2.endTime).toBeNull();
    });
  });

  describe('POST /api/tours - Create tour with NEW day-specific availability format', () => {
    it('should create tour with day-specific schedules (new format)', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availability: [
          { day: 1, startTime: '09:00', endTime: '17:00' }, // Monday
          { day: 2, startTime: '10:00', endTime: '18:00' }, // Tuesday
          { day: 4, startTime: '13:30', endTime: '17:30' }, // Thursday
          { day: 0, startTime: '08:00', endTime: '14:00' }, // Sunday
        ],
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tour.id).toBeDefined();

      // Verify tour was created with new availability format
      const query = new Parse.Query('Tours');
      const tour = await query.get(response.body.data.tour.id, { useMasterKey: true });

      const availability = tour.get('availability');
      expect(availability).toBeDefined();
      expect(Array.isArray(availability)).toBe(true);
      expect(availability).toHaveLength(4);

      // Should be sorted chronologically (Monday first, Sunday last)
      expect(availability[0]).toEqual({ day: 1, startTime: '09:00', endTime: '17:00' });
      expect(availability[1]).toEqual({ day: 2, startTime: '10:00', endTime: '18:00' });
      expect(availability[2]).toEqual({ day: 4, startTime: '13:30', endTime: '17:30' });
      expect(availability[3]).toEqual({ day: 0, startTime: '08:00', endTime: '14:00' });

      // Clean up
      await tour.destroy({ useMasterKey: true });
    });

    it('should reject tour with duplicate days in new format', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availability: [
          { day: 1, startTime: '09:00', endTime: '17:00' },
          { day: 1, startTime: '10:00', endTime: '18:00' }, // Duplicate day
        ],
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Duplicate day code');
    });

    it('should reject tour with invalid day code in new format', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availability: [
          { day: 1, startTime: '09:00', endTime: '17:00' },
          { day: 8, startTime: '10:00', endTime: '18:00' }, // Invalid day code
        ],
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid day code');
    });

    it('should reject tour with endTime before startTime in new format', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availability: [
          { day: 1, startTime: '17:00', endTime: '09:00' }, // Invalid: endTime before startTime
        ],
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('endTime must be after startTime');
    });

    it('should reject tour with invalid time format in new format', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availability: [
          { day: 1, startTime: '25:00', endTime: '17:00' }, // Invalid hour
        ],
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid startTime format');
    });

    it('should reject empty availability array', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availability: [],
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('At least one day schedule must be provided');
    });

    it('should sort unsorted day schedules chronologically', async () => {
      const tourData = {
        destinationPOI: testPOI.id,
        time: 240,
        vehicleType: testVehicleType.id,
        price: 1500,
        rate: testRate.id,
        availability: [
          { day: 0, startTime: '08:00', endTime: '14:00' }, // Sunday (should be last)
          { day: 4, startTime: '13:30', endTime: '17:30' }, // Thursday
          { day: 1, startTime: '09:00', endTime: '17:00' }, // Monday (should be first)
          { day: 2, startTime: '10:00', endTime: '18:00' }, // Tuesday
        ],
      };

      const response = await request(app)
        .post('/api/tours')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(tourData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);

      // Verify sorted order
      const query = new Parse.Query('Tours');
      const tour = await query.get(response.body.data.tour.id, { useMasterKey: true });

      const availability = tour.get('availability');
      expect(availability[0].day).toBe(1); // Monday first
      expect(availability[1].day).toBe(2); // Tuesday
      expect(availability[2].day).toBe(4); // Thursday
      expect(availability[3].day).toBe(0); // Sunday last

      // Clean up
      await tour.destroy({ useMasterKey: true });
    });
  });

  describe('PUT /api/tours/:id - Update tour with NEW availability format', () => {
    let testTour;

    beforeEach(async () => {
      // Create a test tour
      const Tour = Parse.Object.extend('Tours');
      testTour = new Tour();
      testTour.set('destinationPOI', testPOI);
      testTour.set('time', 180);
      testTour.set('vehicleType', testVehicleType);
      testTour.set('price', 1200);
      testTour.set('rate', testRate);
      testTour.set('active', true);
      testTour.set('exists', true);
      await testTour.save(null, { useMasterKey: true });
    });

    afterEach(async () => {
      if (testTour) {
        await testTour.destroy({ useMasterKey: true });
      }
    });

    it('should update tour from legacy to new availability format', async () => {
      // First set legacy format
      testTour.set('availableDays', [1, 2, 4]);
      testTour.set('startTime', '13:30');
      testTour.set('endTime', '17:30');
      await testTour.save(null, { useMasterKey: true });

      // Now update to new format
      const updateData = {
        destinationPOI: testPOI.id,
        time: 180,
        vehicleType: testVehicleType.id,
        price: 1200,
        rate: testRate.id,
        availability: [
          { day: 1, startTime: '09:00', endTime: '17:00' },
          { day: 3, startTime: '10:00', endTime: '16:00' },
          { day: 5, startTime: '11:00', endTime: '19:00' },
        ],
      };

      const response = await request(app)
        .put(`/api/tours/${testTour.id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify tour was updated with new format and legacy fields removed
      await testTour.fetch({ useMasterKey: true });
      const availability = testTour.get('availability');
      expect(availability).toBeDefined();
      expect(availability).toHaveLength(3);
      expect(availability[0]).toEqual({ day: 1, startTime: '09:00', endTime: '17:00' });
      expect(availability[1]).toEqual({ day: 3, startTime: '10:00', endTime: '16:00' });
      expect(availability[2]).toEqual({ day: 5, startTime: '11:00', endTime: '19:00' });

      // Legacy fields should be removed
      expect(testTour.get('availableDays')).toBeUndefined();
      expect(testTour.get('startTime')).toBeUndefined();
      expect(testTour.get('endTime')).toBeUndefined();
    });

    it('should remove all availability fields when set to null', async () => {
      // First add new format availability
      testTour.set('availability', [
        { day: 1, startTime: '09:00', endTime: '17:00' },
        { day: 2, startTime: '10:00', endTime: '18:00' },
      ]);
      await testTour.save(null, { useMasterKey: true });

      // Now remove availability
      const updateData = {
        destinationPOI: testPOI.id,
        time: 180,
        vehicleType: testVehicleType.id,
        price: 1200,
        rate: testRate.id,
        availability: null,
      };

      const response = await request(app)
        .put(`/api/tours/${testTour.id}`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify all availability fields were removed
      await testTour.fetch({ useMasterKey: true });
      expect(testTour.get('availability')).toBeUndefined();
      expect(testTour.get('availableDays')).toBeUndefined();
      expect(testTour.get('startTime')).toBeUndefined();
      expect(testTour.get('endTime')).toBeUndefined();
    });
  });

  describe('GET /api/tours/:id - Get tour with NEW availability format', () => {
    let testTour;

    beforeAll(async () => {
      // Create a test tour with new availability format
      const Tour = Parse.Object.extend('Tours');
      testTour = new Tour();
      testTour.set('destinationPOI', testPOI);
      testTour.set('time', 240);
      testTour.set('vehicleType', testVehicleType);
      testTour.set('price', 1500);
      testTour.set('rate', testRate);
      testTour.set('availability', [
        { day: 1, startTime: '09:00', endTime: '17:00' },
        { day: 2, startTime: '10:00', endTime: '18:00' },
        { day: 4, startTime: '13:30', endTime: '17:30' },
      ]);
      testTour.set('active', true);
      testTour.set('exists', true);
      await testTour.save(null, { useMasterKey: true });
    });

    afterAll(async () => {
      if (testTour) {
        await testTour.destroy({ useMasterKey: true });
      }
    });

    it('should return tour with new availability format', async () => {
      const response = await request(app)
        .get(`/api/tours/${testTour.id}`)
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.tour.availability).toBeDefined();
      expect(Array.isArray(response.body.data.tour.availability)).toBe(true);
      expect(response.body.data.tour.availability).toHaveLength(3);
      expect(response.body.data.tour.availability[0]).toEqual({
        day: 1,
        startTime: '09:00',
        endTime: '17:00',
      });
    });
  });
});
