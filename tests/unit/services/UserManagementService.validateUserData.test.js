/**
 * UserManagementService.validateUserData Unit Tests
 * Covers only the birthDate rule (shared dateValidation standard: 1900-01-01 .. today, no future).
 * Pure validation, no Parse/DB — other required fields are kept valid/minimal so birthDate is the
 * only thing varying between cases.
 */

const UserManagementService = require('../../../src/application/services/UserManagementService');

describe('UserManagementService.validateUserData birthDate rule', () => {
  const userService = new UserManagementService();

  // Minimal valid payload per operation — 'create' requires email/firstName/lastName/role.
  const basePayload = (operation, birthDate) => {
    const payload = operation === 'create'
      ? {
        email: 'client@example.com', firstName: 'Ana', lastName: 'Perez', role: 'client',
      }
      : {};
    if (birthDate !== undefined) payload.birthDate = birthDate;
    return payload;
  };

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const nextYearISO = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  };

  describe.each(['create', 'update'])('operation: %s', (operation) => {
    it('resolves when birthDate is omitted (optional field)', async () => {
      await expect(userService.validateUserData(basePayload(operation), operation))
        .resolves.toBeUndefined();
    });

    it('resolves when birthDate is an empty string', async () => {
      await expect(userService.validateUserData(basePayload(operation, ''), operation))
        .resolves.toBeUndefined();
    });

    it('resolves for a valid past date', async () => {
      await expect(userService.validateUserData(basePayload(operation, '1990-05-20'), operation))
        .resolves.toBeUndefined();
    });

    it('rejects a date before 1900', async () => {
      await expect(userService.validateUserData(basePayload(operation, '1850-01-01'), operation))
        .rejects.toThrow(/Fecha de nacimiento/);
    });

    it('rejects a future date', async () => {
      await expect(userService.validateUserData(basePayload(operation, nextYearISO()), operation))
        .rejects.toThrow(/Fecha de nacimiento/);
    });

    it('resolves for the inclusive lower boundary 1900-01-01', async () => {
      await expect(userService.validateUserData(basePayload(operation, '1900-01-01'), operation))
        .resolves.toBeUndefined();
    });

    it('resolves for the inclusive upper boundary (today)', async () => {
      await expect(userService.validateUserData(basePayload(operation, todayISO()), operation))
        .resolves.toBeUndefined();
    });
  });
});
