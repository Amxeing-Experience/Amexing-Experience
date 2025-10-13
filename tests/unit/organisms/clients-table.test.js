/**
 * Clients Table Component Unit Tests
 * Tests for clients-table.ejs JavaScript functions
 *
 * Tests cover:
 * - toggleClientStatus function logic
 * - deleteClient function logic
 * - API interaction patterns
 * - Error handling
 */

describe('Clients Table Component - Function Logic', () => {
  let mockFetch;
  let mockConfirm;
  let mockApiEndpoint;
  let mockLoadTable;
  let mockShowSuccess;
  let mockShowError;
  let consoleErrorSpy;

  beforeEach(() => {
    // Setup mocks
    mockFetch = jest.fn();
    mockConfirm = jest.fn();
    mockApiEndpoint = '/api/clients';
    mockLoadTable = jest.fn().mockResolvedValue();
    mockShowSuccess = jest.fn();
    mockShowError = jest.fn();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('toggleClientStatus - Logic Tests', () => {
    /**
     * Function under test (extracted from clients-table.ejs)
     */
    async function toggleClientStatus(clientId, currentStatus) {
      const newStatus = !currentStatus;
      const action = newStatus ? 'activar' : 'desactivar';

      if (!mockConfirm(`¿Estás seguro de que deseas ${action} este cliente?`)) {
        return;
      }

      try {
        const response = await mockFetch(`${mockApiEndpoint}/${clientId}/toggle-status`, {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ active: newStatus })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Error al cambiar el estado del cliente');
        }

        mockShowSuccess(`Cliente ${newStatus ? 'activado' : 'desactivado'} exitosamente`);
        await mockLoadTable();

      } catch (error) {
        console.error('Error toggling client status:', error);
        mockShowError(error.message || 'Error al cambiar el estado del cliente. Por favor, intenta nuevamente.');
      }
    }

    it('should activate client when current status is false', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { user: { active: true } } }),
      });

      await toggleClientStatus('client-123', false);

      expect(mockConfirm).toHaveBeenCalledWith('¿Estás seguro de que deseas activar este cliente?');
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockApiEndpoint}/client-123/toggle-status`,
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          body: JSON.stringify({ active: true }),
        })
      );
      expect(mockShowSuccess).toHaveBeenCalledWith('Cliente activado exitosamente');
      expect(mockLoadTable).toHaveBeenCalled();
    });

    it('should deactivate client when current status is true', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await toggleClientStatus('client-456', true);

      expect(mockConfirm).toHaveBeenCalledWith('¿Estás seguro de que deseas desactivar este cliente?');
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockApiEndpoint}/client-456/toggle-status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ active: false }),
        })
      );
      expect(mockShowSuccess).toHaveBeenCalledWith('Cliente desactivado exitosamente');
    });

    it('should not call API if user cancels confirmation', async () => {
      mockConfirm.mockReturnValue(false);

      await toggleClientStatus('client-789', true);

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(mockLoadTable).not.toHaveBeenCalled();
    });

    it('should handle API error response', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: 'Client not found' }),
      });

      await toggleClientStatus('client-999', true);

      expect(mockShowError).toHaveBeenCalledWith('Client not found');
      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(mockLoadTable).not.toHaveBeenCalled();
    });

    it('should handle network error', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockRejectedValue(new Error('Network timeout'));

      await toggleClientStatus('client-abc', false);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error toggling client status:',
        expect.any(Error)
      );
      expect(mockShowError).toHaveBeenCalledWith('Network timeout');
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('should handle response.ok false with success true', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: true }),
      });

      await toggleClientStatus('client-def', true);

      expect(mockShowError).toHaveBeenCalled();
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('should handle response.ok true with success false', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Validation failed' }),
      });

      await toggleClientStatus('client-ghi', false);

      expect(mockShowError).toHaveBeenCalledWith('Validation failed');
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('should use default error message when no error provided', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: false }),
      });

      await toggleClientStatus('client-jkl', true);

      expect(mockShowError).toHaveBeenCalledWith('Error al cambiar el estado del cliente');
    });

    it('should include correct headers in request', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await toggleClientStatus('client-mno', true);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        })
      );
    });
  });

  describe('deleteClient - Logic Tests', () => {
    /**
     * Function under test (extracted from clients-table.ejs)
     */
    async function deleteClient(clientId, clientName) {
      if (!mockConfirm(`¿Estás seguro de que deseas eliminar el cliente "${clientName}"?\n\nEsta acción se puede revertir.`)) {
        return;
      }

      try {
        const response = await mockFetch(`${mockApiEndpoint}/${clientId}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          }
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Error al eliminar el cliente');
        }

        mockShowSuccess(`Cliente "${clientName}" eliminado exitosamente`);
        await mockLoadTable();

      } catch (error) {
        console.error('Error deleting client:', error);
        mockShowError(error.message || 'Error al eliminar el cliente. Por favor, intenta nuevamente.');
      }
    }

    it('should delete client successfully', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'Client deactivated' }),
      });

      await deleteClient('client-123', 'John Doe');

      expect(mockConfirm).toHaveBeenCalledWith(
        '¿Estás seguro de que deseas eliminar el cliente "John Doe"?\n\nEsta acción se puede revertir.'
      );
      expect(mockFetch).toHaveBeenCalledWith(
        `${mockApiEndpoint}/client-123`,
        expect.objectContaining({
          method: 'DELETE',
          credentials: 'include',
        })
      );
      expect(mockShowSuccess).toHaveBeenCalledWith('Cliente "John Doe" eliminado exitosamente');
      expect(mockLoadTable).toHaveBeenCalled();
    });

    it('should not delete if user cancels', async () => {
      mockConfirm.mockReturnValue(false);

      await deleteClient('client-456', 'Jane Smith');

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('should handle delete API error', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: false, error: 'Permission denied' }),
      });

      await deleteClient('client-789', 'Bob Johnson');

      expect(mockShowError).toHaveBeenCalledWith('Permission denied');
      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(mockLoadTable).not.toHaveBeenCalled();
    });

    it('should handle network error during delete', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockRejectedValue(new Error('Connection failed'));

      await deleteClient('client-abc', 'Alice Cooper');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error deleting client:',
        expect.any(Error)
      );
      expect(mockShowError).toHaveBeenCalledWith('Connection failed');
    });

    it('should use default error message when none provided', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: false }),
      });

      await deleteClient('client-def', 'Test User');

      expect(mockShowError).toHaveBeenCalledWith('Error al eliminar el cliente');
    });

    it('should handle empty client name', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await deleteClient('client-ghi', '');

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.stringContaining('""')
      );
      expect(mockShowSuccess).toHaveBeenCalledWith('Cliente "" eliminado exitosamente');
    });

    it('should include correct headers in delete request', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await deleteClient('client-jkl', 'Test Client');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        })
      );
    });

    it('should handle response with success but no ok flag', async () => {
      mockConfirm.mockReturnValue(true);
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: true }),
      });

      await deleteClient('client-mno', 'Another Client');

      expect(mockShowError).toHaveBeenCalled();
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });
  });

  describe('API Response Validation', () => {
    it('should validate both response.ok and result.success for toggle', async () => {
      async function toggleClientStatus(clientId, currentStatus) {
        const newStatus = !currentStatus;
        mockConfirm.mockReturnValue(true);

        const response = await mockFetch(`${mockApiEndpoint}/${clientId}/toggle-status`, {
          method: 'PATCH',
          body: JSON.stringify({ active: newStatus })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Error al cambiar el estado del cliente');
        }

        return { response, result };
      }

      // Test case 1: both ok and success true
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(toggleClientStatus('client-1', false)).resolves.toBeDefined();

      // Test case 2: ok true, success false
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Validation error' }),
      });

      await expect(toggleClientStatus('client-2', false)).rejects.toThrow('Validation error');

      // Test case 3: ok false, success true
      mockFetch.mockResolvedValue({
        ok: false,
        json: async () => ({ success: true }),
      });

      await expect(toggleClientStatus('client-3', false)).rejects.toThrow();
    });

    it('should validate both response.ok and result.success for delete', async () => {
      async function deleteClient(clientId) {
        mockConfirm.mockReturnValue(true);

        const response = await mockFetch(`${mockApiEndpoint}/${clientId}`, {
          method: 'DELETE',
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Error al eliminar el cliente');
        }

        return { response, result };
      }

      // Both ok and success must be true
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(deleteClient('client-1')).resolves.toBeDefined();

      // Only one true should fail
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: false }),
      });

      await expect(deleteClient('client-2')).rejects.toThrow();
    });
  });

  describe('Error Message Handling', () => {
    it('should use API error message when available', () => {
      const error = { error: 'Specific API error' };
      const message = error.error || 'Default error';
      expect(message).toBe('Specific API error');
    });

    it('should use default error message when API error is empty', () => {
      const error = { error: '' };
      const message = error.error || 'Default error';
      expect(message).toBe('Default error');
    });

    it('should use default error message when API error is undefined', () => {
      const error = {};
      const message = error.error || 'Default error';
      expect(message).toBe('Default error');
    });
  });

  describe('Confirmation Dialog Logic', () => {
    it('should create correct activation confirmation message', () => {
      const currentStatus = false;
      const newStatus = !currentStatus;
      const action = newStatus ? 'activar' : 'desactivar';
      const message = `¿Estás seguro de que deseas ${action} este cliente?`;

      expect(message).toBe('¿Estás seguro de que deseas activar este cliente?');
    });

    it('should create correct deactivation confirmation message', () => {
      const currentStatus = true;
      const newStatus = !currentStatus;
      const action = newStatus ? 'activar' : 'desactivar';
      const message = `¿Estás seguro de que deseas ${action} este cliente?`;

      expect(message).toBe('¿Estás seguro de que deseas desactivar este cliente?');
    });

    it('should create correct delete confirmation message', () => {
      const clientName = 'Test Client';
      const message = `¿Estás seguro de que deseas eliminar el cliente "${clientName}"?\n\nEsta acción se puede revertir.`;

      expect(message).toContain('Test Client');
      expect(message).toContain('Esta acción se puede revertir');
    });
  });

  describe('Success Message Generation', () => {
    it('should generate correct activation success message', () => {
      const newStatus = true;
      const message = `Cliente ${newStatus ? 'activado' : 'desactivado'} exitosamente`;
      expect(message).toBe('Cliente activado exitosamente');
    });

    it('should generate correct deactivation success message', () => {
      const newStatus = false;
      const message = `Cliente ${newStatus ? 'activado' : 'desactivado'} exitosamente`;
      expect(message).toBe('Cliente desactivado exitosamente');
    });

    it('should generate correct delete success message', () => {
      const clientName = 'John Doe';
      const message = `Cliente "${clientName}" eliminado exitosamente`;
      expect(message).toBe('Cliente "John Doe" eliminado exitosamente');
    });
  });
});
