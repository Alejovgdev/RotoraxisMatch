import assert from 'node:assert/strict';
import { OfferSalary, SALARY_PERIODS, SALARY_CURRENCIES } from '../src/types/offerSalary';
import { formatOfferSalary, parseSalaryAmount, salaryColumns, salaryFormError, salaryFormFromValue, salaryFromForm, salaryFromRow } from '../src/utils/offerSalary';

async function main() {
  for (const [input, expected] of [['35,50', 35.5], ['35.50', 35.5], ['3500', 3500], [' 0.01 ', 0.01], ['999999999.99', 999999999.99]] as const) {
    assert.equal(parseSalaryAmount(input), expected, input);
  }
  for (const input of ['', '0', '-1', '3.500', '3,500', '1,234.56', '35 EUR', '1e3', 'Infinity', 'NaN', '0.001', '1000000000', '35abc']) {
    assert.equal(parseSalaryAmount(input), null, input);
  }
  assert.equal(salaryFromForm(salaryFormFromValue()), null);
  assert.equal(salaryFormError({ ...salaryFormFromValue(), enabled: true, amount: '35' }), 'Select per hour, day, week, month or year.');
  assert.deepEqual(salaryColumns(undefined), {});
  assert.deepEqual(salaryColumns(null), { salary_amount: null, salary_currency: null, salary_period: null });
  assert.equal(salaryFromRow({}), null); // offers from before migration 062
  assert.equal(formatOfferSalary(null), null);

  for (const { code: period } of SALARY_PERIODS) {
    for (const currency of SALARY_CURRENCIES) {
      const salary: OfferSalary = { amount: 35.5, currency, period };
      assert.deepEqual(salaryFromForm(salaryFormFromValue(salary)), salary);
      assert.deepEqual(salaryFromRow(salaryColumns(salary)), salary);
      assert.equal(formatOfferSalary(salary), `35.5 ${currency} / ${period} · gross`);
    }
  }
  assert.equal(formatOfferSalary({ amount: 3500, currency: 'EUR', period: 'month' }), '3,500 EUR / month · gross');
  assert.deepEqual(salaryFromRow({ salary_amount: '35.50', salary_currency: 'EUR', salary_period: 'hour' }), { amount: 35.5, currency: 'EUR', period: 'hour' });
  for (const amount of [0, -1, NaN, Infinity, 1.001]) {
    assert.throws(() => salaryColumns({ amount, currency: 'EUR', period: 'hour' }));
  }
  assert.throws(() => salaryFromRow({ salary_amount: 35 }));
  for (const currency of ['', 'Other', 'JP', 'JPY1', 'Japanese yen']) {
    assert.throws(() => salaryColumns({ amount: 35, currency, period: 'hour' }));
  }
  const customForm = { ...salaryFormFromValue(), enabled: true, amount: '3500', currency: 'other' as const, customCurrency: ' jpy ', period: 'month' as const };
  const customSalary: OfferSalary = { amount: 3500, currency: 'JPY', period: 'month' };
  assert.deepEqual(salaryFromForm(customForm), customSalary);
  assert.equal(salaryFormFromValue(customSalary).currency, 'other');
  assert.equal(salaryFormFromValue(customSalary).customCurrency, 'JPY');
  assert.deepEqual(salaryFromForm(salaryFormFromValue(customSalary)), customSalary);
  assert.equal(salaryColumns({ ...customSalary, currency: ' jpy ' }).salary_currency, 'JPY');
  assert.equal(formatOfferSalary(customSalary), '3,500 JPY / month · gross');
  assert.ok(salaryFormError({ ...customForm, customCurrency: '' }));
  assert.equal(salaryFromForm({ ...customForm, currency: 'EUR' })?.currency, 'EUR');
  assert.equal(salaryFromForm({ ...customForm, enabled: false }), null);

  // Exercise the real repository and mapper against a minimal PostgREST fake.
  // Only the transport is substituted; selects project fields like the API,
  // so forgetting salary columns would break the round-trip assertions.
  let row: Record<string, unknown> = {};
  let mutations = 0;
  let rejectMutation = false;
  const fakeSupabase = {
    async rpc(_name: string, args: { p_patch: Record<string, unknown> }) {
      mutations++;
      if (rejectMutation) return { data: null, error: null };
      row = { ...row, ...args.p_patch };
      return { data: { ...row }, error: null };
    },
    from(table: string) {
      let selection = '*';
      let write: Record<string, unknown> | undefined;
      let one = false;
      const query = {
        select(columns: string) { selection = columns; return query; },
        eq() { return query; }, in() { return query; }, order() { return query; },
        delete() { return query; },
        insert(data: Record<string, unknown>) { write = data; return query; },
        update(data: Record<string, unknown>) { write = data; return query; },
        single() { one = true; return query; },
        maybeSingle() { one = true; return query; },
        then(resolve: (result: unknown) => unknown) {
          if (table !== 'offers') return Promise.resolve({ data: [], error: null }).then(resolve);
          if (write) {
            mutations++;
            if (rejectMutation) return Promise.resolve({ data: null, error: null }).then(resolve);
            row = { id: 'offer-test', created_at: '2026-09-10', updated_at: '2026-09-10', ...row, ...write };
          }
          const projected = selection === '*' ? { ...row } : Object.fromEntries(selection.split(',').map(k => [k.trim(), row[k.trim()]]));
          return Promise.resolve({ data: one ? projected : [projected], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const modulePath = require.resolve('../src/lib/supabase');
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { supabase: fakeSupabase } } as NodeModule;
  const { offerRepository } = require('../src/repositories/v2/offerRepository') as typeof import('../src/repositories/v2/offerRepository');

  const base = {
    companyId: 'company-test', title: 'Painter', description: 'Aircraft painting',
    contractType: 'permanent' as const, productType: 'Aeroplane' as const,
    technicianType: 'painter' as const, requiresCertification: false,
    location: { country: { code: 'ES', name: 'Spain' }, city: null }, minYearsExperience: 0,
  };
  assert.equal((await offerRepository.create(base)).salary, null);
  assert.deepEqual((await offerRepository.create({ ...base, salary: salaryFromForm(customForm) })).salary, customSalary);
  const manualEdit: OfferSalary = { ...customSalary, currency: 'MXN' };
  assert.deepEqual((await offerRepository.update('offer-test', { salary: manualEdit }))?.salary, manualEdit);
  assert.deepEqual((await offerRepository.getWithRequirements('offer-test'))?.salary, manualEdit);
  assert.equal((await offerRepository.update('offer-test', { salary: null }))?.salary, null);
  for (const { code: period } of SALARY_PERIODS) {
    const salary: OfferSalary = { amount: 3500.25, currency: 'EUR', period };
    assert.deepEqual((await offerRepository.create({ ...base, salary })).salary, salary);
    for (const offers of [await offerRepository.getPublished(), await offerRepository.getForCompany(base.companyId), await offerRepository.getAllWithRequirements()]) {
      assert.deepEqual(offers[0].salary, salary);
    }
    const edited: OfferSalary = { amount: 48000, currency: 'GBP', period: 'year' };
    assert.deepEqual((await offerRepository.update('offer-test', { salary: edited }))?.salary, edited);
    assert.deepEqual((await offerRepository.update('offer-test', { title: 'Updated' }))?.salary, edited);
    assert.equal((await offerRepository.update('offer-test', { salary: null }))?.salary, null);
    assert.equal(row.salary_amount, null);
    assert.equal(row.salary_currency, null);
    assert.equal(row.salary_period, null);
    assert.equal((await offerRepository.getWithRequirements('offer-test'))?.salary, null);
  }
  const before = mutations;
  await assert.rejects(offerRepository.update('offer-test', { productType: 'Helicopter', salary: { amount: -1, currency: 'EUR', period: 'hour' } }));
  assert.equal(mutations, before, 'Invalid salary must fail before a write');
  rejectMutation = true;
  await assert.rejects(offerRepository.update('offer-test', { salary: { amount: 25, currency: 'EUR', period: 'hour' } }), /Could not save/);
  console.log('Offer salary tests passed: amounts, currencies, periods, repository create/read/edit/remove and denied writes.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
