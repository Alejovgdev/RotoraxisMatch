// Precargado (-r) por scripts/testDevDatabaseGuard.cjs: el primer envío corta
// el proceso con código 99 en vez de salir a la red.
globalThis.fetch = () => {
  process.stderr.write('FETCH_ATTEMPTED\n');
  process.exit(99);
};
