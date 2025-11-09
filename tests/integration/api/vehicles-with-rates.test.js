/**
 * Vehicles with Rates Integration Tests
 *
 * Tests vehicle-rate relationship functionality:
 * - Creating vehicles with rate assignment
 * - Updating vehicle rates
 * - Querying vehicles with rate information
 * - Rate validation (valid/invalid rates)
 *
 * Uses MongoDB Memory Server with seeded RBAC system
 */

const request = require("supertest");
const Parse = require("parse/node");
const AuthTestHelper = require("../../helpers/authTestHelper");

describe("Vehicles with Rates Integration", () => {
  let app;
  let superadminToken;
  let adminToken;
  let testVehicleType;
  let testRate;
  let inactiveRate;

  beforeAll(async () => {
    // Import app (Parse Server already running on port 1339)
    app = require("../../../src/index");

    // Wait for app initialization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Login with seeded users (using Parse SDK - no HTTP/CSRF needed)
    superadminToken = await AuthTestHelper.loginAs("superadmin");
    adminToken = await AuthTestHelper.loginAs("admin");

    // Create test vehicle type
    const VehicleTypeClass = Parse.Object.extend("VehicleType");
    testVehicleType = new VehicleTypeClass();
    testVehicleType.set("name", "Test Vehicle Type for Rates");
    testVehicleType.set("code", "TEST_RATE_VT");
    testVehicleType.set("capacity", 4);
    testVehicleType.set("active", true);
    testVehicleType.set("exists", true);
    await testVehicleType.save(null, { useMasterKey: true });

    // Create test active rate
    const RateClass = Parse.Object.extend("Rate");
    testRate = new RateClass();
    testRate.set("name", "Test Rate for Vehicles");
    testRate.set("color", "#FF5733");
    testRate.set("active", true);
    testRate.set("exists", true);
    await testRate.save(null, { useMasterKey: true });

    // Create test inactive rate
    inactiveRate = new RateClass();
    inactiveRate.set("name", "Inactive Test Rate");
    inactiveRate.set("color", "#999999");
    inactiveRate.set("active", false);
    inactiveRate.set("exists", true);
    await inactiveRate.save(null, { useMasterKey: true });
  }, 30000);

  afterAll(async () => {
    // Cleanup test data
    try {
      if (testVehicleType) {
        await testVehicleType.destroy({ useMasterKey: true });
      }
      if (testRate) {
        await testRate.destroy({ useMasterKey: true });
      }
      if (inactiveRate) {
        await inactiveRate.destroy({ useMasterKey: true });
      }

      // Cleanup test vehicles
      const query = new Parse.Query("Vehicle");
      query.matches("brand", /^Test.*Rate/i);
      const testVehicles = await query.find({ useMasterKey: true });
      await Parse.Object.destroyAll(testVehicles, { useMasterKey: true });
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  }, 30000);

  describe("POST /api/vehicles - Create vehicle with rate", () => {
    it("should create vehicle with valid rate assignment", async () => {
      const vehicleData = {
        brand: "Test Brand Rate 1",
        model: "Test Model",
        year: 2024,
        licensePlate: "TEST-RATE-001",
        vehicleTypeId: testVehicleType.id,
        rateId: testRate.id,
        capacity: 4,
        color: "Black",
        maintenanceStatus: "operational",
      };

      const response = await request(app)
        .post("/api/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(vehicleData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.id).toBeDefined();

      // Verify rate is assigned
      const vehicleQuery = new Parse.Query("Vehicle");
      const vehicle = await vehicleQuery.get(response.body.data.id, {
        useMasterKey: true,
      });
      const assignedRate = vehicle.get("rateId");

      expect(assignedRate).toBeDefined();
      expect(assignedRate.id).toBe(testRate.id);
    });

    it("should create vehicle without rate (optional field)", async () => {
      const vehicleData = {
        brand: "Test Brand Rate 2",
        model: "Test Model",
        year: 2024,
        licensePlate: "TEST-RATE-002",
        vehicleTypeId: testVehicleType.id,
        // No rateId provided
        capacity: 4,
        color: "White",
        maintenanceStatus: "operational",
      };

      const response = await request(app)
        .post("/api/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(vehicleData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();

      // Verify rate is null
      const vehicleQuery = new Parse.Query("Vehicle");
      const vehicle = await vehicleQuery.get(response.body.data.id, {
        useMasterKey: true,
      });
      const assignedRate = vehicle.get("rateId");

      expect(assignedRate).toBeUndefined();
    });

    it("should reject invalid rate ID", async () => {
      const vehicleData = {
        brand: "Test Brand Rate 3",
        model: "Test Model",
        year: 2024,
        licensePlate: "TEST-RATE-003",
        vehicleTypeId: testVehicleType.id,
        rateId: "INVALID_RATE_ID_123",
        capacity: 4,
        color: "Blue",
        maintenanceStatus: "operational",
      };

      const response = await request(app)
        .post("/api/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(vehicleData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/rate.*not found/i);
    });

    it("should reject inactive rate assignment", async () => {
      const vehicleData = {
        brand: "Test Brand Rate 4",
        model: "Test Model",
        year: 2024,
        licensePlate: "TEST-RATE-004",
        vehicleTypeId: testVehicleType.id,
        rateId: inactiveRate.id,
        capacity: 4,
        color: "Red",
        maintenanceStatus: "operational",
      };

      const response = await request(app)
        .post("/api/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(vehicleData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/rate.*inactive|rate.*not active/i);
    });
  });

  describe("GET /api/vehicles - Query vehicles with rate information", () => {
    let vehicleWithRate;

    beforeAll(async () => {
      // Create vehicle with rate for testing queries
      const VehicleClass = Parse.Object.extend("Vehicle");
      vehicleWithRate = new VehicleClass();
      vehicleWithRate.set("brand", "Test Query Brand");
      vehicleWithRate.set("model", "Query Model");
      vehicleWithRate.set("year", 2024);
      vehicleWithRate.set("licensePlate", "QUERY-RATE-001");
      vehicleWithRate.set("vehicleTypeId", testVehicleType);
      vehicleWithRate.set("rateId", testRate);
      vehicleWithRate.set("capacity", 4);
      vehicleWithRate.set("color", "Silver");
      vehicleWithRate.set("maintenanceStatus", "operational");
      vehicleWithRate.set("active", true);
      vehicleWithRate.set("exists", true);
      await vehicleWithRate.save(null, { useMasterKey: true });
    });

    afterAll(async () => {
      if (vehicleWithRate) {
        await vehicleWithRate.destroy({ useMasterKey: true });
      }
    });

    it("should include rate information in vehicle list", async () => {
      const response = await request(app)
        .get("/api/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ draw: 1, start: 0, length: 10 })
        .expect(200);

      expect(response.body.data).toBeDefined();

      // Find our test vehicle in results
      const testVehicle = response.body.data.find(
        (v) => v.licensePlate === "QUERY-RATE-001",
      );

      expect(testVehicle).toBeDefined();
      expect(testVehicle.rateId).toBeDefined();
      expect(testVehicle.rateId.id).toBe(testRate.id);
      expect(testVehicle.rateId.name).toBe("Test Rate for Vehicles");
      expect(testVehicle.rateId.color).toBe("#FF5733");
    });

    it("should handle vehicles without rates in list", async () => {
      // Create vehicle without rate
      const VehicleClass = Parse.Object.extend("Vehicle");
      const vehicleNoRate = new VehicleClass();
      vehicleNoRate.set("brand", "Test No Rate Brand");
      vehicleNoRate.set("model", "No Rate Model");
      vehicleNoRate.set("year", 2024);
      vehicleNoRate.set("licensePlate", "NO-RATE-001");
      vehicleNoRate.set("vehicleTypeId", testVehicleType);
      // No rateId set
      vehicleNoRate.set("capacity", 4);
      vehicleNoRate.set("color", "Green");
      vehicleNoRate.set("maintenanceStatus", "operational");
      vehicleNoRate.set("active", true);
      vehicleNoRate.set("exists", true);
      await vehicleNoRate.save(null, { useMasterKey: true });

      const response = await request(app)
        .get("/api/vehicles")
        .set("Authorization", `Bearer ${adminToken}`)
        .query({ draw: 1, start: 0, length: 10 })
        .expect(200);

      const testVehicle = response.body.data.find(
        (v) => v.licensePlate === "NO-RATE-001",
      );

      expect(testVehicle).toBeDefined();
      expect(testVehicle.rateId).toBeNull();

      // Cleanup
      await vehicleNoRate.destroy({ useMasterKey: true });
    });
  });

  describe("PUT /api/vehicles/:id - Update vehicle rate", () => {
    let vehicleToUpdate;

    beforeEach(async () => {
      // Create vehicle for updating
      const VehicleClass = Parse.Object.extend("Vehicle");
      vehicleToUpdate = new VehicleClass();
      vehicleToUpdate.set("brand", "Test Update Brand");
      vehicleToUpdate.set("model", "Update Model");
      vehicleToUpdate.set("year", 2024);
      vehicleToUpdate.set("licensePlate", "UPDATE-RATE-" + Date.now());
      vehicleToUpdate.set("vehicleTypeId", testVehicleType);
      vehicleToUpdate.set("capacity", 4);
      vehicleToUpdate.set("color", "Gray");
      vehicleToUpdate.set("maintenanceStatus", "operational");
      vehicleToUpdate.set("active", true);
      vehicleToUpdate.set("exists", true);
      await vehicleToUpdate.save(null, { useMasterKey: true });
    });

    afterEach(async () => {
      if (vehicleToUpdate) {
        try {
          await vehicleToUpdate.destroy({ useMasterKey: true });
        } catch (error) {
          // Vehicle might already be deleted
        }
      }
    });

    it("should update vehicle with new rate", async () => {
      const response = await request(app)
        .put(`/api/vehicles/${vehicleToUpdate.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ rateId: testRate.id })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify rate updated
      await vehicleToUpdate.fetch({ useMasterKey: true });
      const assignedRate = vehicleToUpdate.get("rateId");
      expect(assignedRate).toBeDefined();
      expect(assignedRate.id).toBe(testRate.id);
    });

    it("should remove rate from vehicle (set to null)", async () => {
      // First assign a rate
      vehicleToUpdate.set("rateId", testRate);
      await vehicleToUpdate.save(null, { useMasterKey: true });

      // Now remove it
      const response = await request(app)
        .put(`/api/vehicles/${vehicleToUpdate.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ rateId: null })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify rate removed
      await vehicleToUpdate.fetch({ useMasterKey: true });
      const assignedRate = vehicleToUpdate.get("rateId");
      expect(assignedRate).toBeUndefined();
    });

    it("should reject update with invalid rate", async () => {
      const response = await request(app)
        .put(`/api/vehicles/${vehicleToUpdate.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ rateId: "INVALID_RATE_XYZ" })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/rate.*not found/i);
    });

    it("should reject update with inactive rate", async () => {
      const response = await request(app)
        .put(`/api/vehicles/${vehicleToUpdate.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ rateId: inactiveRate.id })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toMatch(/rate.*inactive|rate.*not active/i);
    });
  });

  describe("GET /api/vehicles/:id - Get single vehicle with rate", () => {
    let vehicleWithRate;

    beforeAll(async () => {
      const VehicleClass = Parse.Object.extend("Vehicle");
      vehicleWithRate = new VehicleClass();
      vehicleWithRate.set("brand", "Test Single Brand");
      vehicleWithRate.set("model", "Single Model");
      vehicleWithRate.set("year", 2024);
      vehicleWithRate.set("licensePlate", "SINGLE-RATE-001");
      vehicleWithRate.set("vehicleTypeId", testVehicleType);
      vehicleWithRate.set("rateId", testRate);
      vehicleWithRate.set("capacity", 4);
      vehicleWithRate.set("color", "Purple");
      vehicleWithRate.set("maintenanceStatus", "operational");
      vehicleWithRate.set("active", true);
      vehicleWithRate.set("exists", true);
      await vehicleWithRate.save(null, { useMasterKey: true });
    });

    afterAll(async () => {
      if (vehicleWithRate) {
        await vehicleWithRate.destroy({ useMasterKey: true });
      }
    });

    it("should return vehicle with rate details", async () => {
      const response = await request(app)
        .get(`/api/vehicles/${vehicleWithRate.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.rateId).toBe(testRate.id);
    });
  });
});
