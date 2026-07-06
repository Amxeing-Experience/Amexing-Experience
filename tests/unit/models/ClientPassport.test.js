/**
 * ClientPassport.validate() Unit Tests
 * Covers the static date/owner validation (no Parse calls happen inside validate()).
 */

const ClientPassport = require('../../../src/domain/models/ClientPassport');

// YYYY-MM-DD 'years' away from today (negative = past), optionally shifted by 'days' too.
function isoOffset(years, days = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('ClientPassport.validate', () => {
  it('passes with no date-related errors when both dates are omitted', () => {
    const errors = ClientPassport.validate({ ownerId: 'user-1' });
    expect(errors).toEqual([]);
  });

  it('accepts a past dateOfIssue alone (no expirationDate to cross-check)', () => {
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      dateOfIssue: isoOffset(-5),
    });
    expect(errors).toEqual([]);
  });

  it('accepts a future expirationDate alone, within the 20-year cap', () => {
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      expirationDate: isoOffset(3),
    });
    expect(errors).toEqual([]);
  });

  it('rejects a dateOfIssue in the future', () => {
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      dateOfIssue: isoOffset(1),
    });
    expect(errors).toContain('Fecha de emisión no puede ser una fecha futura');
  });

  it('rejects a dateOfIssue before 1900', () => {
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      dateOfIssue: '1899-12-31',
    });
    expect(errors).toContain('Fecha de emisión no puede ser anterior a 1900');
  });

  it('rejects an expirationDate before 1900', () => {
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      expirationDate: '1899-12-31',
    });
    expect(errors).toContain('Fecha de expiración no puede ser anterior a 1900');
  });

  it('rejects an expirationDate more than 20 years in the future', () => {
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      expirationDate: isoOffset(21),
    });
    expect(errors).toContain('Fecha de expiración es demasiado lejana');
  });

  it('rejects when expirationDate equals dateOfIssue (must be strictly after)', () => {
    const sameDay = isoOffset(-1);
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      dateOfIssue: sameDay,
      expirationDate: sameDay,
    });
    expect(errors).toContain('La fecha de expiración debe ser posterior a la de emisión');
  });

  it('rejects when expirationDate is before dateOfIssue', () => {
    // Both dates are in the past, so allowFuture:true's per-field rule doesn't reject expirationDate
    // on its own (it only enforces the 1900 floor / +20y cap, not "must not be in the past") —
    // only the cross-field check should fire here.
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      dateOfIssue: '2024-01-01',
      expirationDate: '2020-01-01',
    });
    expect(errors).toContain('La fecha de expiración debe ser posterior a la de emisión');
    expect(errors).not.toContain('Fecha de expiración no puede ser anterior a 1900');
    expect(errors).not.toContain('Fecha de expiración es demasiado lejana');
  });

  it('accepts a fully valid passport: past issue, future expiration after issue', () => {
    const errors = ClientPassport.validate({
      ownerId: 'user-1',
      dateOfIssue: isoOffset(-5),
      expirationDate: isoOffset(3),
    });
    expect(errors).toEqual([]);
  });

  it('reports the owner-required error independent of date correctness', () => {
    const errors = ClientPassport.validate({
      dateOfIssue: isoOffset(-5),
      expirationDate: isoOffset(3),
    });
    expect(errors).toContain('Owner (client or user) is required');
  });

  it('accepts data.client as an alternative to ownerId', () => {
    const errors = ClientPassport.validate({ client: 'client-1' });
    expect(errors).toEqual([]);
  });
});
