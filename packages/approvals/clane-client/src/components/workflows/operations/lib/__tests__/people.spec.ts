import { personName } from '../people';

const me = { id: 'u-42', name: 'Abhishek Jha', email: 'abhishek@example.com' };

describe('personName', () => {
  it('names the signed-in user from their own session', () => {
    expect(personName('user:u-42', me, [])).toBe('Abhishek Jha');
  });

  it('uses the label the platform attached to the decision event', () => {
    const events = [{ type: 'approved', payload: { by: 'user:u-7', by_label: 'dana@example.com' } }];
    expect(personName('user:u-7', me, events)).toBe('dana@example.com');
  });

  it('accepts the other label spellings the engine may store', () => {
    expect(personName('user:u-7', me, [{ type: 'rejected', payload: { by: 'user:u-7', actor_label: 'lee@example.com' } }])).toBe(
      'lee@example.com',
    );
  });

  it('names an operator-token decision by its owner', () => {
    expect(personName('operator:abhishek', me, [])).toBe('abhishek');
  });

  it('never shows a raw platform id', () => {
    expect(personName('user:u-7', me, [])).toBeNull();
    expect(personName('', me, [])).toBeNull();
  });

  it('keeps a plain name as it is', () => {
    expect(personName('Priya Raman', null, [])).toBe('Priya Raman');
  });
});
