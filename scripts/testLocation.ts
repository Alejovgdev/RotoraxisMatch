// Tests de la infraestructura de localización (Fase 7, F2a).
//
// Sin red y sin Supabase: el envoltorio del directorio de ciudades recibe un
// `fetch` falso por inyección, y la caché de países un fetcher falso. Todo lo
// que se ejerce aquí es determinista.
//
// Lo que se protege, por orden de importancia:
//
//   1. Que un 404 del proveedor sea CERO RESULTADOS y no un error. La API de
//      countries.dev responde 404 con 'No cities found' en text/plain cuando
//      no hay coincidencias — comprobado contra el endpoint real. Tratarlo
//      como fallo pintaría un aviso de error al teclear media palabra.
//   2. Que un fallo de red NUNCA lance. El servicio es una comodidad: si
//      lanzara, acabaría en un catch que corta un formulario.
//   3. Que una fila corrupta del proveedor no se convierta en una ciudad con
//      coordenadas falsas — en F2c eso sería un pin en el sitio equivocado.
//   4. Que la URL del proveedor viva en UN solo fichero.
//
// Run: npm run test:location
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createCityDirectory } from '../src/repositories/v2/cityDirectoryRepository';
import { createLocationCountriesCache } from '../src/repositories/v2/locationCountriesCache';
import { CountryCatalogEntry, getCityCoordinates } from '../src/types/location';
import {
  indexCountriesByCode,
  locationColumns,
  locationValueFromPersisted,
  persistedLocationFromAirport,
  persistedLocationFromValue,
  resolveMapPin,
} from '../src/utils/locationBridge';
import { groupTechnicianMapMarkers } from '../src/utils/technicianMapMarkers';
import { buildOfferMapMarkerIcon, buildOfferMapMarkerSvg, offerMapMarkerShape } from '../src/utils/offerMapMarkerIcon';
import { buildOfferMapMarkerUpdateScript } from '../src/utils/offerMapWebViewBridge';
import { matchesTechnicianSearchIdentity } from '../src/utils/technicianSearchFilterMatch';
import { LOCATION_CITY_INDEX, resolveLocationSnapshot } from '../src/constants/locationCities';
import { findCountry } from '../src/constants/countries';
import { formatLocation } from '../src/utils/formatLocation';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS — ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL — ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

// ── Respuestas falsas ─────────────────────────────────────────────────────

const MALAGA_ROW = {
  geonameId: 2514256,
  name: 'Málaga',
  asciiName: 'Malaga',
  countryCode: 'ES',
  admin1Code: '51',
  latitude: 36.72016,
  longitude: -4.42034,
  population: 592346,
  timezone: 'Europe/Madrid',
  featureCode: 'PPLA2',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

/** Un fetch falso que anota las URLs pedidas. */
function stubFetch(handler: (url: string) => Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

async function main() {
  console.log('\n=== LOCALIZACIÓN — directorio de ciudades y catálogo de países ===\n');

  // ── El envoltorio del directorio ────────────────────────────────────────

  await test('Directorio — una respuesta normal se mapea a ciudades', async () => {
    const { fn, calls } = stubFetch(async () => jsonResponse([MALAGA_ROW]));
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'malaga', countryCode: 'ES' });

    assert.equal(outcome.status, 'ok');
    if (outcome.status !== 'ok') return;
    assert.equal(outcome.cities.length, 1);
    assert.equal(outcome.cities[0].name, 'Málaga');
    assert.equal(outcome.cities[0].asciiName, 'Malaga');
    assert.equal(outcome.cities[0].latitude, 36.72016);
    assert.equal(outcome.cities[0].geonameId, 2514256);
    // El país va en mayúsculas y el texto codificado.
    assert.ok(calls[0].includes('country=ES'), calls[0]);
    assert.ok(calls[0].includes('q=malaga'), calls[0]);
  });

  await test('Directorio — 404 "No cities found" es CERO RESULTADOS, no un error', async () => {
    // Éste es el test que justifica la suite entera. La API responde así ante
    // una búsqueda que simplemente no encaja todavía.
    const { fn } = stubFetch(async () => textResponse('No cities found', 404));
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'zzzzqqq', countryCode: 'ES' });

    assert.equal(outcome.status, 'ok');
    if (outcome.status !== 'ok') return;
    assert.deepEqual(outcome.cities, []);
  });

  await test('Directorio — un cuerpo que no es JSON es "malformed", no un fallo de red', async () => {
    // Distinguirlos importa: 'malformed' significa que el proveedor cambió el
    // contrato, y eso se arregla tocando código, no reintentando.
    const { fn } = stubFetch(async () => textResponse('<html>gateway</html>', 200));
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'madrid', countryCode: 'ES' });

    assert.equal(outcome.status, 'unavailable');
    if (outcome.status !== 'unavailable') return;
    assert.equal(outcome.reason, 'malformed');
  });

  await test('Directorio — JSON que no es un array también es "malformed"', async () => {
    const { fn } = stubFetch(async () => jsonResponse({ error: 'nope' }));
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'madrid', countryCode: 'ES' });

    assert.equal(outcome.status, 'unavailable');
    if (outcome.status !== 'unavailable') return;
    assert.equal(outcome.reason, 'malformed');
  });

  await test('Directorio — un 5xx es "http" y no lanza', async () => {
    const { fn } = stubFetch(async () => textResponse('boom', 503));
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'madrid', countryCode: 'ES' });

    assert.equal(outcome.status, 'unavailable');
    if (outcome.status !== 'unavailable') return;
    assert.equal(outcome.reason, 'http');
  });

  await test('Directorio — la red caída devuelve "network" en vez de lanzar', async () => {
    // La garantía central: con la red muerta el usuario sigue escribiendo.
    const { fn } = stubFetch(async () => {
      throw new TypeError('Network request failed');
    });
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'madrid', countryCode: 'ES' });

    assert.equal(outcome.status, 'unavailable');
    if (outcome.status !== 'unavailable') return;
    assert.equal(outcome.reason, 'network');
    assert.ok(outcome.error instanceof Error);
  });

  await test('Directorio — pasado el techo de tiempo es "timeout", no "aborted"', async () => {
    // Los dos abortan la petición; sólo uno es culpa del proveedor. Si el
    // timeout se reportara como 'aborted', el hook lo ignoraría en silencio y
    // la lista se quedaría "buscando" para siempre.
    const { fn } = stubFetch(
      (url) =>
        new Promise<Response>((_resolve, reject) => {
          void url;
          setTimeout(() => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          }, 40);
        }),
    );
    const directory = createCityDirectory({ fetchImpl: fn, timeoutMs: 10 });

    const outcome = await directory.searchCities({ query: 'madrid', countryCode: 'ES' });

    assert.equal(outcome.status, 'unavailable');
    if (outcome.status !== 'unavailable') return;
    assert.equal(outcome.reason, 'timeout');
  });

  await test('Directorio — cancelar por el que llama es "aborted", que no es un fallo', async () => {
    const controller = new AbortController();
    const { fn } = stubFetch(
      () =>
        new Promise<Response>((_resolve, reject) => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          setTimeout(() => reject(err), 5);
        }),
    );
    const directory = createCityDirectory({ fetchImpl: fn, timeoutMs: 5000 });

    const promise = directory.searchCities({ query: 'mad', countryCode: 'ES', signal: controller.signal });
    controller.abort();
    const outcome = await promise;

    assert.equal(outcome.status, 'aborted');
  });

  await test('Directorio — una señal ya abortada no llega a pedir nada', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fn, calls } = stubFetch(async () => jsonResponse([MALAGA_ROW]));
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'mad', countryCode: 'ES', signal: controller.signal });

    assert.equal(outcome.status, 'aborted');
    assert.equal(calls.length, 0);
  });

  await test('Directorio — las filas corruptas se descartan una a una, no la respuesta entera', async () => {
    // Que 1 de 4 venga rota no puede dejar al usuario sin las otras 3. Y
    // ninguna de las rotas puede colarse: una ciudad "del directorio" sin
    // coordenadas reales acaba siendo un pin en el sitio equivocado.
    const { fn } = stubFetch(async () =>
      jsonResponse([
        MALAGA_ROW,
        { ...MALAGA_ROW, geonameId: 1, latitude: undefined },
        { ...MALAGA_ROW, geonameId: 2, name: '   ' },
        { ...MALAGA_ROW, geonameId: 3, longitude: 999 },
        { ...MALAGA_ROW, geonameId: 4, name: 'Sevilla' },
      ]),
    );
    const directory = createCityDirectory({ fetchImpl: fn });

    const outcome = await directory.searchCities({ query: 'a', countryCode: 'ES' });

    assert.equal(outcome.status, 'ok');
    if (outcome.status !== 'ok') return;
    assert.deepEqual(
      outcome.cities.map((c) => c.name),
      ['Málaga', 'Sevilla'],
    );
  });

  await test('Directorio — sin país válido no se pide nada, y no es un fallo', async () => {
    const { fn, calls } = stubFetch(async () => jsonResponse([MALAGA_ROW]));
    const directory = createCityDirectory({ fetchImpl: fn });

    for (const countryCode of ['', '   ', 'E', 'ESP', '12']) {
      const outcome = await directory.searchCities({ query: 'madrid', countryCode });
      assert.equal(outcome.status, 'ok', `countryCode=${countryCode}`);
      if (outcome.status !== 'ok') continue;
      assert.deepEqual(outcome.cities, [], `countryCode=${countryCode}`);
    }
    assert.equal(calls.length, 0, 'no debería haber salido ninguna petición');
  });

  await test('Directorio — el país se normaliza a mayúsculas y el límite se acota', async () => {
    const { fn, calls } = stubFetch(async () => jsonResponse([]));
    const directory = createCityDirectory({ fetchImpl: fn });

    await directory.searchCities({ query: 'x', countryCode: 'es', limit: 999 });
    await directory.searchCities({ query: 'x', countryCode: 'ES', limit: 0 });

    assert.ok(calls[0].includes('country=ES'), calls[0]);
    assert.ok(calls[0].includes('limit=50'), `el límite debería acotarse a 50: ${calls[0]}`);
    assert.ok(calls[1].includes('limit=1'), `el límite mínimo es 1: ${calls[1]}`);
  });

  await test('Directorio — el texto se codifica para la URL', async () => {
    const { fn, calls } = stubFetch(async () => jsonResponse([]));
    const directory = createCityDirectory({ fetchImpl: fn });

    await directory.searchCities({ query: '  a coruña & vigo  ', countryCode: 'ES' });

    assert.ok(!calls[0].includes(' '), `sin espacios crudos: ${calls[0]}`);
    assert.ok(calls[0].includes('%26') || !calls[0].includes('&vigo'), `el & va codificado: ${calls[0]}`);
    // Y recortado: los espacios de los extremos no son parte de la búsqueda.
    assert.ok(!calls[0].includes('q=%20'), calls[0]);
  });

  // ── La distinción que F2c necesita ──────────────────────────────────────

  await test('Ciudad — sólo la elegida del directorio tiene coordenadas', () => {
    assert.deepEqual(
      getCityCoordinates({
        kind: 'directory',
        name: 'Madrid',
        geonameId: 3117735,
        latitude: 40.4165,
        longitude: -3.70256,
        timezone: 'Europe/Madrid',
      }),
      { latitude: 40.4165, longitude: -3.70256 },
    );

    // Escrita a mano: no hay coordenadas, y `null` es la respuesta CORRECTA,
    // no un error. En F2c significa "no pintes pin de ciudad, cae al país".
    assert.equal(getCityCoordinates({ kind: 'manual', name: 'Madrid' }), null);
    assert.equal(getCityCoordinates(null), null);
  });

  // ── La caché del catálogo de países ─────────────────────────────────────

  const COUNTRIES: CountryCatalogEntry[] = [
    { code: 'ES', name: 'Spain', latitude: 40, longitude: -4 },
    { code: 'FR', name: 'France', latitude: 46, longitude: 2 },
  ];

  await test('Países — dentro del TTL se sirve lo cacheado sin volver a pedir', async () => {
    let calls = 0;
    let clock = 1000;
    const cache = createLocationCountriesCache({
      fetchActive: async () => {
        calls += 1;
        return COUNTRIES;
      },
      ttlMs: 500,
      now: () => clock,
    });

    assert.deepEqual(await cache.getActiveCountries(), COUNTRIES);
    clock += 100;
    await cache.getActiveCountries();
    assert.equal(calls, 1);

    clock += 1000; // TTL vencido
    await cache.getActiveCountries();
    assert.equal(calls, 2);
  });

  await test('Países — las llamadas concurrentes comparten una sola petición', async () => {
    let calls = 0;
    const cache = createLocationCountriesCache({
      fetchActive: async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return COUNTRIES;
      },
    });

    const [a, b, c] = await Promise.all([
      cache.getActiveCountries(),
      cache.getActiveCountries(),
      cache.getActiveCountries(),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(a, COUNTRIES);
    assert.deepEqual(b, COUNTRIES);
    assert.deepEqual(c, COUNTRIES);
  });

  await test('Países — un refresco fallido NO vacía el catálogo que ya funcionaba', async () => {
    // Un desplegable de países que se queda vacío porque falló un refresco de
    // fondo es peor que uno ligeramente viejo.
    let shouldFail = false;
    let clock = 0;
    const cache = createLocationCountriesCache({
      fetchActive: async () => {
        if (shouldFail) throw new Error('network down');
        return COUNTRIES;
      },
      ttlMs: 100,
      now: () => clock,
    });

    await cache.getActiveCountries();
    shouldFail = true;
    clock += 500; // fuerza refresco

    const served = await cache.getActiveCountries();
    assert.deepEqual(served, COUNTRIES, 'debería seguir sirviendo el catálogo anterior');
    assert.equal(cache.getState().status, 'success');
    assert.ok(cache.getState().error, 'el error queda anotado aunque se siga sirviendo');
  });

  await test('Países — sin catálogo previo, el fallo se propaga y queda en "error"', async () => {
    // Aquí NO se puede servir nada, y hay que decirlo: caer a una lista
    // hardcodeada sería tener dos fuentes para el mismo catálogo.
    const cache = createLocationCountriesCache({
      fetchActive: async () => {
        throw new Error('network down');
      },
    });

    await assert.rejects(() => cache.getActiveCountries(), /network down/);
    assert.equal(cache.getState().status, 'error');
    assert.deepEqual(cache.getState().countries, []);
  });

  await test('Países — tras un fallo, la siguiente llamada reintenta sola', async () => {
    let attempts = 0;
    const cache = createLocationCountriesCache({
      fetchActive: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient');
        return COUNTRIES;
      },
    });

    await assert.rejects(() => cache.getActiveCountries());
    assert.deepEqual(await cache.getActiveCountries(), COUNTRIES);
    assert.equal(attempts, 2);
  });

  await test('Países — invalidate() fuerza la siguiente petición', async () => {
    let calls = 0;
    const cache = createLocationCountriesCache({
      fetchActive: async () => {
        calls += 1;
        return COUNTRIES;
      },
    });

    await cache.getActiveCountries();
    await cache.getActiveCountries();
    assert.equal(calls, 1);

    cache.invalidate();
    assert.equal(cache.getState().status, 'empty');
    await cache.getActiveCountries();
    assert.equal(calls, 2);
  });

  // ── El puente aeropuerto -> país + ciudad (F2b) ─────────────────────────

  await test('Puente — deriva país ISO y ciudad del aeropuerto', () => {
    assert.deepEqual(persistedLocationFromAirport('airport:LEVC'), {
      locationCountryCode: 'ES',
      locationCityName: 'Valencia',
    });
    assert.deepEqual(persistedLocationFromAirport('airport:EBLG'), {
      locationCountryCode: 'BE',
      locationCityName: 'Liège',
    });
    assert.deepEqual(persistedLocationFromAirport('airport:DAAG'), {
      locationCountryCode: 'DZ',
      locationCityName: 'Algiers',
    });
  });

  await test('Puente — NUNCA devuelve coordenadas del aeropuerto', () => {
    // Las del aeropuerto no son las de la ciudad: Barajas está a 12 km del
    // centro de Madrid. Un pin preciso y falso es peor que ninguno, así que
    // esto no es un detalle de implementación, es la regla.
    for (const id of ['airport:LEVC', 'airport:LEAL', 'airport:LIRF', 'airport:SEGU']) {
      const location = persistedLocationFromAirport(id);
      assert.ok(location, id);
      if (!location) continue;
      assert.equal(location.locationCityLat, undefined, id);
      assert.equal(location.locationCityLng, undefined, id);
      assert.equal(location.locationCityGeonameId, undefined, id);
    }
  });

  await test('Puente — TODO país del catálogo de aeropuertos resuelve a un ISO', () => {
    // Si uno solo no resolviera, guardar el perfil de ese técnico lanzaría.
    // Comprobado además contra location_country_aliases en vivo: 0
    // discrepancias entre este mapa y el de Postgres, en los 65.
    const countries = [...new Set(LOCATION_CITY_INDEX.map((e) => e.countryName))];
    const orphans = countries.filter((name) => !findCountry(name));
    assert.deepEqual(orphans, [], `Países sin código ISO: ${orphans.join(', ')}`);
    assert.ok(countries.length >= 60, `Sólo ${countries.length} países: ¿se vació el catálogo?`);

    // Y que cada aeropuerto, uno a uno, produzca un país de dos letras.
    for (const entry of LOCATION_CITY_INDEX) {
      const location = persistedLocationFromAirport(entry.id);
      assert.ok(location, entry.id);
      if (!location) continue;
      assert.match(location.locationCountryCode, /^[A-Z]{2}$/, entry.id);
      assert.ok(location.locationCityName, `${entry.id} sin ciudad`);
    }
  });

  await test('Puente legado — un aeropuerto desconocido devuelve null, no lanza', () => {
    // Fase 7 F2c: este puente sólo lo usa ya AuthContext, para metadata de
    // cuentas creadas antes del despliegue. Devuelve null en vez de lanzar
    // porque ahí un throw abortaría el alta entera; el RPC da entonces un
    // mensaje claro sobre el país que falta.
    assert.equal(persistedLocationFromAirport('airport:NOPE'), null);
  });

  // ── La garantía de "ningún score cambia" ────────────────────────────────

  await test('Scorer — quitar location_city y location_base_airport no puede mover un score', () => {
    // El scorer resuelve la localización de la oferta así:
    //   resolveLocationSnapshot({ locationCityId, country, city, baseAirport })
    // y `resolveAirportCity` prueba PRIMERO por locationCityId. Como esa
    // columna es NOT NULL con FK a location_airports, siempre resuelve, y los
    // otros tres argumentos NUNCA se miran.
    //
    // Por eso la 059 puede retirar `offers.location_city` y
    // `offers.location_base_airport` sin tocar un solo punto: son entradas
    // muertas. Esto lo comprueba en vez de confiar en la lectura del código.
    for (const entry of LOCATION_CITY_INDEX) {
      const soloId = resolveLocationSnapshot({ locationCityId: entry.id });

      // Con los campos denormalizados correctos.
      const conDatos = resolveLocationSnapshot({
        locationCityId: entry.id,
        country: entry.countryName,
        city: entry.city,
        baseAirport: entry.iata || entry.icao,
      });
      assert.deepEqual(conDatos, soloId, entry.id);

      // Y con basura dentro: si el id manda, ni siquiera esto cambia nada.
      const conBasura = resolveLocationSnapshot({
        locationCityId: entry.id,
        country: 'Wrongland',
        city: 'Nowhere',
        baseAirport: 'ZZZZ',
      });
      assert.deepEqual(conBasura, soloId, `${entry.id} con datos contradictorios`);
    }
  });

  // ── La regla del pin (F2c) ──────────────────────────────────────────────

  const CATALOG: CountryCatalogEntry[] = [
    { code: 'ES', name: 'Spain',   latitude: 40, longitude: -4 },
    { code: 'DZ', name: 'Algeria', latitude: 28, longitude: 3 },
  ];
  const BY_CODE = indexCountriesByCode(CATALOG);

  await test('Pin — ciudad del directorio: sus propias coordenadas', () => {
    const pin = resolveMapPin(
      { locationCountryCode: 'ES', locationCityLat: 36.72016, locationCityLng: -4.42034 },
      BY_CODE,
    );
    assert.deepEqual(pin, { latitude: 36.72016, longitude: -4.42034, precision: 'city' });
  });

  await test('Pin — ciudad a mano o sin ciudad: centroide del país', () => {
    // Los 11 registros migrados en F2b son exactamente este caso: tienen
    // nombre de ciudad y NINGUNA coordenada, a propósito.
    const aMano = resolveMapPin({ locationCountryCode: 'DZ' }, BY_CODE);
    assert.deepEqual(aMano, { latitude: 28, longitude: 3, precision: 'country' });

    // Y el caso que motivó `precision`: el centroide de Argelia cae en el
    // Sáhara, lejísimos de donde está su aviación. El punto es correcto como
    // encuadre y MENTIRA como dirección — por eso viaja etiquetado.
    assert.equal(aMano?.precision, 'country');
  });

  await test('Pin — país desconocido: sin pin, en vez de un pin en (0,0)', () => {
    assert.equal(resolveMapPin({ locationCountryCode: 'ZZ' }, BY_CODE), null);
  });

  await test('Pin — media coordenada no cuenta como ciudad', () => {
    // El CHECK de la 057 lo impide en Postgres; aquí se comprueba que el
    // cliente tampoco lo interpreta como un punto válido.
    const pin = resolveMapPin({ locationCountryCode: 'ES', locationCityLat: 36.7 }, BY_CODE);
    assert.equal(pin?.precision, 'country');
  });

  await test('Búsqueda — varios oficios se combinan con OR', () => {
    const technician = {
      technicianTypes: ['mechanic', 'avionic'],
      locationCountryCode: 'ES',
      locationCityGeonameId: 3117735,
      country: 'Spain',
      city: 'Madrid',
    };

    assert.equal(matchesTechnicianSearchIdentity(technician, {
      technicianTypes: ['sheet_metal_worker', 'avionic'],
    }), true);
    assert.equal(matchesTechnicianSearchIdentity(technician, {
      technicianTypes: ['sheet_metal_worker', 'painter'],
    }), false);
  });

  await test('Búsqueda — país ISO y ciudad del directorio usan identificadores estables', () => {
    const technician = {
      technicianTypes: ['sheet_metal_worker'],
      locationCountryCode: 'ES',
      locationCityGeonameId: 3117735,
      country: 'Spain',
      city: 'Madrid',
    };

    assert.equal(matchesTechnicianSearchIdentity(technician, {
      countryCode: 'ES',
      cityGeonameId: 3117735,
    }), true);
    assert.equal(matchesTechnicianSearchIdentity(technician, {
      countryCode: 'AR',
      cityGeonameId: 3117735,
    }), false);
    assert.equal(matchesTechnicianSearchIdentity(technician, {
      countryCode: 'ES',
      cityGeonameId: 3435910,
    }), false);
    assert.equal(matchesTechnicianSearchIdentity(technician, {
      countryCode: 'ES',
      city: 'Madrid',
    }), true);
    assert.equal(matchesTechnicianSearchIdentity(technician, {
      countryCode: 'ES',
      city: 'Barcelona',
    }), false);
  });

  await test('Mapa de técnicos — tres centroides de España forman un grupo de tres', () => {
    const groups = groupTechnicianMapMarkers([
      { id: 'tech-1', latitude: 40, longitude: -4, locationPrecision: 'country' as const },
      { id: 'tech-2', latitude: 40, longitude: -4, locationPrecision: 'country' as const },
      { id: 'tech-3', latitude: 40.000003, longitude: -4.000003, locationPrecision: 'country' as const },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].technicians.length, 3);
    assert.equal(groups[0].locationPrecision, 'country');
    assert.deepEqual(groups[0].technicians.map((technician) => technician.id), [
      'tech-1',
      'tech-2',
      'tech-3',
    ]);
  });

  await test('Mapa de técnicos — dos técnicos de la misma ciudad comparten grupo', () => {
    const groups = groupTechnicianMapMarkers([
      { id: 'valencia-1', latitude: 39.4699, longitude: -0.3763, locationPrecision: 'city' as const },
      { id: 'valencia-2', latitude: 39.4699, longitude: -0.3763, locationPrecision: 'city' as const },
      { id: 'madrid', latitude: 40.4168, longitude: -3.7038, locationPrecision: 'city' as const },
    ]);

    assert.equal(groups.length, 2);
    assert.equal(groups[0].technicians.length, 2);
    assert.equal(groups[0].locationPrecision, 'city');
    assert.equal(groups[1].technicians[0].id, 'madrid');
  });

  await test('Mapa de técnicos — un punto ciudad/país mixto no se solapa ni finge precisión', () => {
    const groups = groupTechnicianMapMarkers([
      { id: 'city', latitude: 40, longitude: -4, locationPrecision: 'city' as const },
      { id: 'country', latitude: 40, longitude: -4, locationPrecision: 'country' as const },
      { id: 'invalid', latitude: Number.NaN, longitude: -4, locationPrecision: 'country' as const },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].technicians.length, 2);
    assert.equal(groups[0].locationPrecision, 'mixed');
  });

  await test('Mapa de técnicos nativo — el JavaScript real del WebView sigue siendo válido', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/TechnicianMap.native.tsx'),
      'utf8',
    );
    const template = source.match(/const LEAFLET_HTML = `([\s\S]*?)`;\r?\n/);
    assert.ok(template, 'No encuentro LEAFLET_HTML');

    // Evalúa primero el template literal, porque los escapes que ve WKWebView
    // no son los mismos que se ven en el fuente TypeScript.
    const html = new Function(`return \`${template[1]}\`;`)() as string;
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    assert.equal(inlineScripts.length, 1);
    const inlineScript = inlineScripts[0][1];
    assert.doesNotThrow(() => new Function(inlineScript));

    const messages: string[] = [];
    let markerClickHandler: (() => void) | null = null;
    const mapStub = { setView: () => mapStub, fitBounds: () => undefined };
    const layerStub = { addTo: () => layerStub, clearLayers: () => undefined };
    const markerStub = {
      setStyle: () => markerStub,
      on: (event: string, handler: () => void) => {
        if (event === 'click') markerClickHandler = handler;
        return markerStub;
      },
      bindTooltip: () => markerStub,
      addTo: () => markerStub,
    };
    const leafletStub = {
      map: () => mapStub,
      tileLayer: () => ({ addTo: () => undefined }),
      layerGroup: () => layerStub,
      circleMarker: () => markerStub,
    };
    const windowStub: Record<string, any> = {
      ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
    };
    const runtime = new Function(
      'window',
      'L',
      `${inlineScript}\nreturn { AVAIL, initMap };`,
    )(windowStub, leafletStub) as {
      AVAIL: Record<string, string>;
      initMap: () => void;
    };
    assert.deepEqual(Object.keys(runtime.AVAIL).sort(), ['open_to_offers', 'unavailable']);
    assert.equal(runtime.AVAIL.open_to_offers, '#10B981');
    runtime.initMap();
    windowStub.updateMarkers(JSON.stringify([{
      key: '40.00000:-4.00000',
      latitude: 40,
      longitude: -4,
      locationPrecision: 'country',
      technicians: ['tech-1', 'tech-2', 'tech-3'].map((id) => ({
        id,
        availability: 'open_to_offers',
      })),
    }]));
    assert.ok(markerClickHandler, 'El marcador no registró la selección');
    (markerClickHandler as () => void)();
    assert.ok(messages.includes('map-select-group:40.00000:-4.00000'));
    assert.doesNotMatch(source, /\.bindPopup\(/);
    assert.match(source, /TechnicianMapDetailSheet/);
  });

  await test('Mapa de ofertas nativo — el payload acepta apóstrofes, comillas y saltos de línea', () => {
    const payload = [{
      id: "offer-o'brien",
      title: "O'Brien \"A320\"\nNight <shift> & support",
      companyName: "D'Angelo Aviation",
      location: "L'Aquila",
    }];
    const script = buildOfferMapMarkerUpdateScript(payload);
    let received = '';

    assert.doesNotThrow(() => {
      new Function('window', script)({
        updateOfferMarkers: (serialized: string) => { received = serialized; },
      });
    });
    assert.deepEqual(JSON.parse(received), payload);
    assert.ok(!script.includes('encodeURIComponent'));
  });

  await test('Offer map - contract shapes and neutral groups use stable SVG geometry', () => {
    assert.equal(offerMapMarkerShape('permanent'), 'circle');
    assert.equal(offerMapMarkerShape('long_term'), 'square');
    assert.equal(offerMapMarkerShape('short_term'), 'diamond');

    const circle = buildOfferMapMarkerSvg({ shape: 'circle', color: '#10B981' });
    const square = buildOfferMapMarkerSvg({ shape: 'square', color: '#2563EB' });
    const diamond = buildOfferMapMarkerSvg({ shape: 'diamond', color: '#F59E0B' });
    const cluster = buildOfferMapMarkerSvg({ shape: 'cluster', color: '#EF4444', count: 104 });

    assert.match(circle, /<circle cx="28" cy="28" r="16"/);
    assert.match(square, /<rect x="12" y="12" width="32" height="32"/);
    assert.match(diamond, /<path d="M28 9 47 28 28 47 9 28Z"/);
    assert.match(cluster, /fill="#0A1520"/);
    assert.match(cluster, />99\+<\/text>/);
    assert.doesNotMatch(cluster, /#EF4444/);
    for (const svg of [circle, square, diamond, cluster]) {
      assert.match(svg, /width="56" height="56" viewBox="0 0 56 56"/);
      assert.match(svg, /offer-marker-selection/);
    }
  });

  await test('Mapa de ofertas nativo — HTML, errores tempranos y selección de hoja son ejecutables', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/OfferMap.native.tsx'),
      'utf8',
    );
    const webSource = readFileSync(
      join(process.cwd(), 'src/components/OfferMapLeafletImpl.tsx'),
      'utf8',
    );
    assert.doesNotMatch(source, /circleMarker|dashArray/);
    assert.doesNotMatch(webSource, /CircleMarker|dashArray/);
    assert.match(source, /L\.divIcon/);
    // Ambos renderers construyen el marcador por el mismo helper, para que la
    // forma, el color y el nivel no puedan divergir entre web y nativo.
    assert.match(webSource, /offerMapGroupMarkerIcon/);
    assert.match(source, /offerMapGroupMarkerIcon/);
    assert.match(source, /OfferMapDetailSheet/);
    assert.match(webSource, /OfferMapDetailSheet/);
    const template = source.match(/const LEAFLET_HTML = `([\s\S]*?)`;\r?\n/);
    assert.ok(template, 'No encuentro LEAFLET_HTML');
    const html = new Function(`return \`${template[1]}\`;`)() as string;
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    assert.equal(inlineScripts.length, 2, 'El relay temprano y el mapa deben ser scripts separados');
    for (const script of inlineScripts) assert.doesNotThrow(() => new Function(script[1]));

    const messages: string[] = [];
    let markerClickHandler: (() => void) | null = null;
    const windowStub: Record<string, any> = {
      ReactNativeWebView: { postMessage: (message: string) => messages.push(message) },
    };
    let setViewCalls = 0;
    let fitBoundsCalls = 0;
    const mapListeners: Record<string, () => void> = {};
    const mapStub = {
      setView: () => { setViewCalls += 1; return mapStub; },
      fitBounds: () => { fitBoundsCalls += 1; },
      on: (event: string, handler: () => void) => { mapListeners[event] = handler; return mapStub; },
      getZoom: () => 7,
    };
    const markerLayerStub = {
      addTo: () => markerLayerStub,
      clearLayers: () => undefined,
    };
    const markerIcons: Array<{ html?: string; iconSize?: number[]; iconAnchor?: number[] }> = [];
    let selectedOffset = 0;
    const markerAttributes: Record<string, string> = {};
    const markerElement = {
      classList: { add: () => undefined, remove: () => undefined },
      setAttribute: (name: string, value: string) => { markerAttributes[name] = value; },
    };
    const leafletStub = {
      map: () => mapStub,
      tileLayer: () => ({ addTo: () => undefined }),
      layerGroup: () => markerLayerStub,
      divIcon: (options: { html?: string }) => {
        markerIcons.push(options);
        return options;
      },
      marker: () => {
        const marker = {
          on: (event: string, handler: () => void) => {
            if (event === 'click') markerClickHandler = handler;
            return marker;
          },
          addTo: () => marker,
          getElement: () => markerElement,
          setZIndexOffset: (offset: number) => { selectedOffset = offset; return marker; },
        };
        return marker;
      },
    };

    new Function('window', inlineScripts[0][1])(windowStub);
    const runtime = new Function(
      'window',
      'L',
      `${inlineScripts[1][1]}\nreturn { initMap };`,
    )(windowStub, leafletStub) as {
      initMap: () => void;
    };

    windowStub.onerror('Unexpected identifier offer');
    assert.ok(messages.some((message) => message.includes('offer-map-error:JavaScript error:')));

    runtime.initMap();
    assert.ok(messages.includes('offer-map-ready'));
    // El nivel de marcador se decide en React Native, así que el mapa tiene
    // que anunciar su zoom: al arrancar y en cada zoomend.
    assert.ok(messages.includes('offer-map-zoom:7'), 'El mapa no anunció su zoom inicial');
    assert.ok(mapListeners.zoomend, 'Nadie escucha zoomend');

    const markerGroup = {
      key: '40.00000:-4.00000:country',
      latitude: 40,
      longitude: -4,
      locationPrecision: 'country',
      accessibilityLabel: 'Permanent offer in L Aquila, country-level location',
      ...buildOfferMapMarkerIcon({ shape: 'circle', color: '#0891B2' }),
      offers: [{
        id: "offer-o'brien",
        title: "O'Brien <A320>",
        companyName: 'D"Angelo',
        location: "L'Aquila & coast",
        score: 88,
        matchLabel: 'Strong',
        markerColor: '#0891B2',
        labelColor: '#0891B2',
        blocked: false,
        contractLabel: 'Contract',
        productLabel: 'Aircraft',
        approximate: true,
      }],
    };

    // initMap ya hizo su setView de arranque; lo que se mide es lo que añade
    // cada repintado por encima de eso.
    const setViewAfterInit = setViewCalls;

    new Function('window', buildOfferMapMarkerUpdateScript({ groups: [markerGroup], fit: true }))(windowStub);
    assert.equal(setViewCalls, setViewAfterInit + 1, 'Un cambio de ofertas sí encuadra');

    // Un repintado por cambio de nivel de marcador NO puede reencuadrar: el
    // usuario acaba de elegir su zoom a mano y se lo estaríamos quitando.
    new Function('window', buildOfferMapMarkerUpdateScript({ groups: [markerGroup], fit: false }))(windowStub);
    assert.equal(setViewCalls, setViewAfterInit + 1, 'Un repintado sin fit reencuadró igualmente');
    assert.equal(fitBoundsCalls, 0);

    mapListeners.zoomend();
    assert.equal(messages.filter((message) => message === 'offer-map-zoom:7').length, 3);

    assert.equal(markerIcons.length, 2);
    assert.deepEqual(markerIcons[0].iconSize, [56, 56]);
    assert.deepEqual(markerIcons[0].iconAnchor, [28, 28]);
    assert.match(markerIcons[0].html ?? '', /<circle cx="28" cy="28" r="16"/);
    assert.equal(markerAttributes.role, 'button');
    assert.match(markerAttributes['aria-label'], /Permanent offer/);
    assert.ok(markerClickHandler, 'El marcador no registró la selección');
    (markerClickHandler as () => void)();
    assert.equal(selectedOffset, 10000);
    assert.ok(messages.includes('offer-map-select:40.00000:-4.00000:country'));
    const salaryMarker = buildOfferMapMarkerIcon({ shape: 'square', color: '#2563EB', salary: { amount: 3500, currency: 'MXN', period: 'month' } });
    new Function('window', buildOfferMapMarkerUpdateScript({
      groups: [{
        key: '40.00000:-4.00000:country', latitude: 40, longitude: -4,
        accessibilityLabel: '3,500 MXN / month gross', ...salaryMarker,
        offers: [{ id: 'salary-offer' }],
      }],
      fit: false,
    }))(windowStub);
    assert.deepEqual(markerIcons[2].iconSize, salaryMarker.iconSize);
    assert.deepEqual(markerIcons[2].iconAnchor, salaryMarker.iconAnchor);
    assert.match(markerIcons[2].html ?? '', /3,500 MXN/);
    assert.equal(selectedOffset, 10000, 'Selection survives a marker update');
    assert.doesNotMatch(source, /\.bindPopup\(/);
  });

  await test('Offer markers — exact salaries, variable bounds, safe SVG and count priority', () => {
    for (const period of ['hour', 'day', 'week', 'month', 'year'] as const) {
      const marker = buildOfferMapMarkerIcon({ shape: 'diamond', color: '#2563EB', salary: { amount: 35.25, currency: 'JPY', period } });
      assert.match(marker.markerSvg, /35.25 JPY/);
      assert.ok(marker.markerSvg.includes(`/ ${period} · gross`));
      assert.deepEqual(marker.iconAnchor, [marker.iconSize[0] / 2, 60]);
      assert.ok(marker.iconSize[0] >= 132);
      assert.match(marker.markerSvg, /offer-marker-selection/);
    }
    const salary = { amount: 999999999.99, currency: 'MXN', period: 'year' as const };
    const large = buildOfferMapMarkerIcon({ shape: 'circle', color: '#10B981', salary });
    assert.match(large.markerSvg, /999,999,999.99 MXN/);
    assert.ok(large.iconSize[0] > 180);
    const group = buildOfferMapMarkerIcon({ shape: 'circle', color: '#10B981', salary, count: 4 });
    assert.match(group.markerSvg, />4<\/text>/);
    assert.doesNotMatch(group.markerSvg, /gross|MXN/);
    assert.deepEqual(group.iconSize, [56, 56]);
    const unpriced = buildOfferMapMarkerIcon({ shape: 'square', color: '#10B981', salary: null });
    assert.doesNotMatch(unpriced.markerSvg, /gross/);
    const escaped = buildOfferMapMarkerSvg({ shape: 'circle', color: 'red" onload="alert(1)', salary: { ...salary, currency: '<script>&' } });
    assert.doesNotMatch(escaped, /<script>|onload=/);
    assert.match(escaped, /&lt;script&gt;&amp;/);
    assert.match(escaped, /#527088/);
  });

  // ── Selector <-> fila ───────────────────────────────────────────────────

  await test('Escritura — la ciudad del directorio guarda sus coordenadas; la de a mano, no', () => {
    const directorio = persistedLocationFromValue({
      country: { code: 'ES', name: 'Spain' },
      city: { kind: 'directory', name: 'Málaga', geonameId: 2514256, latitude: 36.72, longitude: -4.42, timezone: 'Europe/Madrid' },
    });
    assert.deepEqual(directorio, {
      locationCountryCode: 'ES', locationCityName: 'Málaga',
      locationCityLat: 36.72, locationCityLng: -4.42, locationCityGeonameId: 2514256,
    });

    const aMano = persistedLocationFromValue({
      country: { code: 'ES', name: 'Spain' },
      city: { kind: 'manual', name: 'Mi pueblo' },
    });
    assert.deepEqual(aMano, { locationCountryCode: 'ES', locationCityName: 'Mi pueblo' });

    const sinCiudad = persistedLocationFromValue({ country: { code: 'ES', name: 'Spain' }, city: null });
    assert.deepEqual(sinCiudad, { locationCountryCode: 'ES' });
  });

  await test('Escritura — las cinco columnas van SIEMPRE, y las vacías a null', () => {
    // Es la garantía contra el pin huérfano: cambiar de país tiene que
    // limpiar las coordenadas de la ciudad anterior, no dejarlas.
    assert.deepEqual(locationColumns({ locationCountryCode: 'FR' }), {
      location_country_code: 'FR',
      location_city_name: null,
      location_city_lat: null,
      location_city_lng: null,
      location_city_geoname_id: null,
    });
  });

  await test('Escritura — sin país se para en seco', () => {
    assert.throws(() => persistedLocationFromValue({ country: null, city: null }), /requires a country/);
  });

  await test('Lectura — la fila vuelve al selector conservando de dónde vino la ciudad', () => {
    const delDirectorio = locationValueFromPersisted(
      { locationCountryCode: 'ES', locationCityName: 'Málaga', locationCityLat: 36.72, locationCityLng: -4.42, locationCityGeonameId: 2514256 },
      'Spain',
    );
    assert.equal(delDirectorio.city?.kind, 'directory');

    const aMano = locationValueFromPersisted(
      { locationCountryCode: 'ES', locationCityName: 'Mi pueblo' },
      'Spain',
    );
    assert.equal(aMano.city?.kind, 'manual');
    assert.equal(getCityCoordinates(aMano.city), null);
  });

  // ── La regla arquitectónica, como test ──────────────────────────────────

  await test('Arquitectura — ningún mapper lee una columna que su SELECT no pide', () => {
    // ⚠ ESTE ES EL BUG QUE MÁS VECES HA VUELTO en esta misión:
    //   · OFFER_COLUMNS sin `product_type`                        (migración 047)
    //   · OFFER_COLUMNS sin `license_code` / `requires_all_aircraft` (F2b)
    //   · offerPatchToDb sin esas dos                             (Fase 6 tanda D)
    //   · publicRowToPrivateCompat leyendo `location_city_id`     (F2d)
    //
    // Siempre igual: el SELECT deja de pedir una columna, el mapper la sigue
    // leyendo, y el campo llega `undefined` SIN QUE NADA FALLE. Los tipos
    // cuadran, no hay excepción, y el dato deja de viajar en silencio.
    //
    // Escrito como comentario se erosiona. Escrito como test, no.
    const root = process.cwd();
    const mappers = readFileSync(join(root, 'src/repositories/v2/supabaseMappers.ts'), 'utf8');
    const techRepo = readFileSync(join(root, 'src/repositories/v2/technicianRepositoryV2.ts'), 'utf8');
    const offerRepo = readFileSync(join(root, 'src/repositories/v2/offerRepository.ts'), 'utf8');

    /** Las columnas que un SELECT pide, sin los embeds de PostgREST. */
    function columnsOf(source: string, constName: string): Set<string> {
      const at = source.indexOf('const ' + constName);
      assert.ok(at >= 0, 'No encuentro ' + constName);
      const eq = source.indexOf('=', at);
      const quote = source[source.search(/[`']/) >= 0 ? 0 : 0]; // no usado
      void quote;
      // El literal va entre backticks o comillas simples; se toma hasta el
      // siguiente ';' de la declaración, que es donde termina en los tres casos.
      const raw = source.slice(eq + 1, source.indexOf(';', eq));
      return new Set(
        raw
          .replace(/[`']/g, '')
          // fuera los embeds `tabla ( col )`: sus columnas no son de la fila
          .replace(/[a-z_]+\s*\([^)]*\)/gi, '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      );
    }

    /** Los `row.x` que lee el cuerpo de una función exportada. */
    function rowReadsOf(source: string, fnName: string): string[] {
      const start = source.indexOf('export function ' + fnName + '(');
      assert.ok(start >= 0, 'No encuentro ' + fnName);
      const next = source.indexOf('export function ', start + 1);
      const body = source
        .slice(start, next < 0 ? undefined : next)
        // Sin comentarios: si no, el guardián se delata a sí mismo — un
        // comentario que EXPLICA que ya no se lee `row.location_city_id`
        // contaba como si lo leyera.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      const found = body.match(/\brow\.[a-z_][a-z0-9_]*/g) ?? [];
      return [...new Set(found.map((m) => m.slice(4)))];
    }

    const pares = [
      { select: 'PUBLIC_SELECT', from: techRepo, fn: 'mapPublicTechnicianRow' },
      { select: 'PUBLIC_SELECT', from: techRepo, fn: 'publicRowToPrivateCompat' },
      { select: 'PRIVATE_SELECT', from: techRepo, fn: 'mapPrivateTechnicianRow' },
      { select: 'OFFER_COLUMNS', from: offerRepo, fn: 'mapOfferRow' },
    ];

    // Cada exención va justificada, o no es una exención sino un bug tapado.
    //
    //   user_id, location_countries — llegan por otra vía (la vista los expone
    //     sin que el SELECT los nombre, o vienen de un embed).
    //
    //   created_at, updated_at — ⚠ `technician_public_view` NO LOS EXPONE, y
    //     `publicRowToPrivateCompat` los resuelve con `?? now`: inventa la
    //     fecha actual. No es la fuga silenciosa que este test persigue (el
    //     fallback es explícito), pero SÍ es dato inventado — la misma familia
    //     que el `birthDate: '1970-01-01'` que hacía a todos los técnicos
    //     "56 años" ante una empresa. Anotado aquí, sin arreglar: cambiarlo
    //     toca el contrato de TechnicianWithRelations y es su propia tanda.
    const EXENTAS = new Set(['user_id', 'location_countries', 'created_at', 'updated_at']);

    const fugas: string[] = [];
    for (const { select, from, fn } of pares) {
      const pedidas = columnsOf(from, select);
      assert.ok(pedidas.size > 3, `${select} parece vacío: el guardián no comprobaría nada`);
      for (const col of rowReadsOf(mappers, fn)) {
        if (EXENTAS.has(col)) continue;
        if (!pedidas.has(col)) fugas.push(`${fn} lee row.${col}, que ${select} no pide`);
      }
    }

    assert.deepEqual(fugas, [], fugas.join(' | '));
  });

  await test('Arquitectura — sólo cityDirectoryRepository conoce la URL del proveedor', () => {
    // "Toda la app pide ciudades a este módulo, nunca a la URL directamente."
    // Escrito como comentario se erosiona; escrito como test, no.
    //
    // Se busca 'https://countries.dev', no el dominio a secas: lo que está
    // prohibido es CONSTRUIR la petición en otro sitio, no nombrar el
    // servicio. Nombrarlo hace falta — la atribución de la CC BY en
    // terms-of-service.tsx lo cita por obligación legal, y varios comentarios
    // explican de dónde salen los datos. Un guardián que prohibiera la
    // palabra obligaría a borrar precisamente la documentación que sirve.
    const FORBIDDEN = 'https://countries.dev';
    const ALLOWED = 'src/repositories/v2/cityDirectoryRepository.ts';
    // La raíz del proyecto, no __dirname: este fichero se ejecuta ya
    // compilado desde .tmp-test-location/scripts, donde no hay src/ ni app/.
    // npm ejecuta los scripts desde la raíz del paquete.
    const root = process.cwd();
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const rel = relative(root, full).split('\\').join('/');
        if (rel === ALLOWED) continue;
        if (readFileSync(full, 'utf8').includes(FORBIDDEN)) offenders.push(rel);
      }
    }

    // Si los directorios no están donde se espera, este test pasaría sin
    // haber mirado nada — un guardián que no mira es peor que ninguno.
    for (const dir of ['src', 'app']) {
      assert.ok(
        statSync(join(root, dir)).isDirectory(),
        `No encuentro ${dir}/ desde ${root}: el rastreo no habría comprobado nada.`,
      );
    }

    walk(join(root, 'src'));
    walk(join(root, 'app'));

    // Y que el fichero permitido SÍ contenga la URL: si alguien la moviera,
    // el rastreo pasaría en verde por vacío en vez de avisar del cambio.
    assert.ok(
      readFileSync(join(root, ALLOWED), 'utf8').includes(FORBIDDEN),
      `${ALLOWED} ya no contiene la URL del proveedor: o se movió, o este guardián dejó de tener sentido.`,
    );

    assert.deepEqual(
      offenders,
      [],
      `Estos ficheros construyen la URL del proveedor en vez de pasar por ${ALLOWED}: ${offenders.join(', ')}`,
    );
  });

  // ── Ajustes finales de Fase 10 · "ciudad, país" sin coma suelta ────────

  await test('Ubicación — sin ciudad no queda coma suelta, ni con país en código ni con nombre', () => {
    assert.equal(formatLocation('Madrid', 'Spain'), 'Madrid, Spain');
    assert.equal(formatLocation('', 'Spain'), 'Spain');
    assert.equal(formatLocation(undefined, 'ES'), 'ES');
    assert.equal(formatLocation(null, 'ES'), 'ES');
    assert.equal(formatLocation('   ', 'ES'), 'ES', 'una ciudad sólo con espacios tampoco cuenta');
    assert.equal(formatLocation(' Sevilla ', ' ES '), 'Sevilla, ES');
    assert.equal(formatLocation('Madrid', undefined), 'Madrid');
    assert.equal(formatLocation(undefined, undefined), '', 'sin nada, vacío: el llamador decide qué pintar');
  });

  await test('Arquitectura — ninguna pantalla pega "ciudad, país" a mano', () => {
    // Cada `${city}, ${country}` escrito a mano era un ", ES" esperando a un
    // técnico sin ciudad. Los tres patrones que había: JSX, plantilla y
    // array con filter(Boolean).join.
    const PATTERNS = [
      /(city|City)\}\s*,\s*\$?\{[^}]*(country|Country)/,
      /\[[^\]]*(city|City)[^\]]*(country|Country)[^\]]*\]\s*\.filter\(Boolean\)/,
    ];
    const ALLOWED = 'src/utils/formatLocation.ts';
    const root = process.cwd();
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        const rel = relative(root, full).split('\\').join('/');
        if (rel === ALLOWED) continue;
        readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
          if (PATTERNS.some((p) => p.test(line))) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }

    for (const dir of ['src', 'app']) {
      assert.ok(statSync(join(root, dir)).isDirectory(), `falta ${dir}/: el guardián no miraría nada`);
      walk(join(root, dir));
    }
    // Y que los patrones SÍ detectan lo que prohíben: si no, el guardián
    // pasaría en verde por no reconocer nada.
    assert.ok(PATTERNS[0].test('{offer.locationCity}, {offer.locationCountry}'));
    assert.ok(PATTERNS[0].test('`${technician.city}, ${technician.country}`'));
    assert.ok(PATTERNS[1].test('[account.city, account.country].filter(Boolean).join(", ")'));

    assert.deepEqual(offenders, [], `Usa formatLocation() de ${ALLOWED}: ${offenders.join(', ')}`);
  });
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
  });
