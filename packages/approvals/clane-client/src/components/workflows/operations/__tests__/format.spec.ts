import { count, usd } from '../format';

describe('format', () => {
  it('formats dollars with two decimals and a dash for nothing', () => {
    expect(usd(1.5)).toBe('$1.50');
    expect(usd(0)).toBe('$0.00');
    expect(usd(null)).toBe('-');
    expect(usd(Number.NaN)).toBe('-');
  });
  it('counts with the right noun', () => {
    expect(count(1, 'step', 'steps')).toBe('1 step');
    expect(count(3, 'step', 'steps')).toBe('3 steps');
  });
});
