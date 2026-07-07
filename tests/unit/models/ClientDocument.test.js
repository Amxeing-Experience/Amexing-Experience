/**
 * ClientDocument Unit Tests
 * Covers the pure static helpers (no Parse network calls): isSensitiveLabel,
 * labelRequiresCustom, validate.
 */

const ClientDocument = require('../../../src/domain/models/ClientDocument');

describe('ClientDocument.isSensitiveLabel', () => {
  ClientDocument.SENSITIVE_LABELS.forEach(label => {
    it(`returns true for sensitive label "${label}"`, () => {
      expect(ClientDocument.isSensitiveLabel(label)).toBe(true);
    });
  });

  ClientDocument.DOCUMENT_LABELS
    .filter(label => !ClientDocument.SENSITIVE_LABELS.includes(label))
    .forEach(label => {
      it(`returns false for non-sensitive label "${label}"`, () => {
        expect(ClientDocument.isSensitiveLabel(label)).toBe(false);
      });
    });

  it('returns false for an unknown/garbage label', () => {
    expect(ClientDocument.isSensitiveLabel('Nota adhesiva')).toBe(false);
  });

  it('returns false for undefined/null', () => {
    expect(ClientDocument.isSensitiveLabel(undefined)).toBe(false);
    expect(ClientDocument.isSensitiveLabel(null)).toBe(false);
  });
});

describe('ClientDocument.labelRequiresCustom', () => {
  it('is true only for "Otro documento"', () => {
    expect(ClientDocument.labelRequiresCustom('Otro documento')).toBe(true);
  });

  ClientDocument.DOCUMENT_LABELS
    .filter(label => label !== 'Otro documento')
    .forEach(label => {
      it(`is false for "${label}"`, () => {
        expect(ClientDocument.labelRequiresCustom(label)).toBe(false);
      });
    });

  it('is false for garbage input', () => {
    expect(ClientDocument.labelRequiresCustom('otro documento')).toBe(false);
    expect(ClientDocument.labelRequiresCustom(undefined)).toBe(false);
    expect(ClientDocument.labelRequiresCustom(null)).toBe(false);
  });
});

describe('ClientDocument.validate', () => {
  it('requires an owner when neither client nor ownerId is set', () => {
    const errors = ClientDocument.validate({ label: 'Pasaporte' });
    expect(errors).toContain('Owner (client or user) is required');
  });

  it('accepts data.client as the owner', () => {
    const errors = ClientDocument.validate({ client: 'client-obj', label: 'Pasaporte' });
    expect(errors).not.toContain('Owner (client or user) is required');
  });

  it('accepts data.ownerId as the owner', () => {
    const errors = ClientDocument.validate({ ownerId: 'owner-123', label: 'Pasaporte' });
    expect(errors).not.toContain('Owner (client or user) is required');
  });

  it('requires a valid label when missing', () => {
    const errors = ClientDocument.validate({ ownerId: 'owner-123' });
    expect(errors).toContain('A valid label is required');
  });

  it('requires a valid label when it is not in DOCUMENT_LABELS', () => {
    const errors = ClientDocument.validate({ ownerId: 'owner-123', label: 'Nota adhesiva' });
    expect(errors).toContain('A valid label is required');
  });

  it('requires customLabel when label is "Otro documento" and customLabel is missing', () => {
    const errors = ClientDocument.validate({ ownerId: 'owner-123', label: 'Otro documento' });
    expect(errors).toContain('customLabel is required for "Otro documento"');
  });

  it('requires customLabel when label is "Otro documento" and customLabel is blank/whitespace', () => {
    const blank = ClientDocument.validate({ ownerId: 'owner-123', label: 'Otro documento', customLabel: '' });
    const whitespace = ClientDocument.validate({ ownerId: 'owner-123', label: 'Otro documento', customLabel: '   ' });
    expect(blank).toContain('customLabel is required for "Otro documento"');
    expect(whitespace).toContain('customLabel is required for "Otro documento"');
  });

  it('does not require customLabel when label is "Otro documento" and customLabel is provided', () => {
    const errors = ClientDocument.validate({
      ownerId: 'owner-123',
      label: 'Otro documento',
      customLabel: 'Carta de recomendación',
    });
    expect(errors).not.toContain('customLabel is required for "Otro documento"');
  });

  it('returns no errors for a fully valid payload', () => {
    expect(ClientDocument.validate({ ownerId: 'owner-123', label: 'Pasaporte' })).toEqual([]);
    expect(ClientDocument.validate({
      ownerId: 'owner-123',
      label: 'Otro documento',
      customLabel: 'Carta de recomendación',
    })).toEqual([]);
  });
});
