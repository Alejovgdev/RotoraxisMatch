import { normalizeCountryName } from './countries';

export type LocationCityId = `airport:${string}`;

export interface AirportCity {
  id: LocationCityId;
  city: string;
  airport: string;
  icao: string;
  iata: string;
  latitude: number;
  longitude: number;
}

export interface AirportCityWithCountry extends AirportCity {
  countryName: string;
}

export interface LocationReference {
  locationCityId?: string;
  country?: string;
  city?: string;
  baseAirport?: string;
}

export interface LocationSnapshot {
  locationCityId: LocationCityId;
  country: string;
  city: string;
  baseAirport: string;
  latitude: number;
  longitude: number;
}

// Curated MVP airport catalog. This is not intended to be a complete worldwide database;
// add airport rows on demand as the market expands.
export const LOCATION_CITIES: Record<string, AirportCity[]> = {
  Algeria: [
    { id: 'airport:DAAG', city: 'Algiers', airport: 'Houari Boumediene Airport', icao: 'DAAG', iata: 'ALG', latitude: 36.693886, longitude: 3.214531  },
    { id: 'airport:DAOO', city: 'Oran', airport: 'Ahmed Ben Bella Airport', icao: 'DAOO', iata: 'ORN', latitude: 35.620648, longitude: -0.622486  },
    { id: 'airport:DABC', city: 'Constantine', airport: 'Mohamed Boudiaf International Airport', icao: 'DABC', iata: 'CZL', latitude: 36.276001, longitude: 6.62039  },
  ],
  Argentina: [
    { id: 'airport:SAEZ', city: 'Buenos Aires', airport: 'Ministro Pistarini International Airport', icao: 'SAEZ', iata: 'EZE', latitude: -34.8222, longitude: -58.5358  },
    { id: 'airport:SACO', city: 'Córdoba', airport: 'Ambrosio Taravella International Airport', icao: 'SACO', iata: 'COR', latitude: -31.312346, longitude: -64.208329  },
    { id: 'airport:SAME', city: 'Mendoza', airport: 'Governor Francisco Gabrielli International Airport', icao: 'SAME', iata: 'MDZ', latitude: -32.831699, longitude: -68.7929  },
    { id: 'airport:SAAR', city: 'Rosario', airport: 'Islas Malvinas International Airport', icao: 'SAAR', iata: 'ROS', latitude: -32.9036, longitude: -60.785  },
  ],
  Australia: [
    { id: 'airport:YSSY', city: 'Sydney', airport: 'Sydney Kingsford Smith Airport', icao: 'YSSY', iata: 'SYD', latitude: -33.946098, longitude: 151.177002  },
    { id: 'airport:YMML', city: 'Melbourne', airport: 'Melbourne Airport', icao: 'YMML', iata: 'MEL', latitude: -37.670732, longitude: 144.837898  },
    { id: 'airport:YBBN', city: 'Brisbane', airport: 'Brisbane Airport', icao: 'YBBN', iata: 'BNE', latitude: -27.384199, longitude: 153.117004  },
    { id: 'airport:YPPH', city: 'Perth', airport: 'Perth Airport', icao: 'YPPH', iata: 'PER', latitude: -31.9403, longitude: 115.967003  },
    { id: 'airport:YPAD', city: 'Adelaide', airport: 'Adelaide Airport', icao: 'YPAD', iata: 'ADL', latitude: -34.947512, longitude: 138.533393  },
  ],
  Austria: [
    { id: 'airport:LOWW', city: 'Vienna', airport: 'Vienna International Airport', icao: 'LOWW', iata: 'VIE', latitude: 48.110298, longitude: 16.5697  },
    { id: 'airport:LOWS', city: 'Salzburg', airport: 'Salzburg Airport W. A. Mozart', icao: 'LOWS', iata: 'SZG', latitude: 47.793301, longitude: 13.0043  },
    { id: 'airport:LOWI', city: 'Innsbruck', airport: 'Innsbruck Airport', icao: 'LOWI', iata: 'INN', latitude: 47.260201, longitude: 11.344  },
  ],
  Bahrain: [
    { id: 'airport:OBBI', city: 'Manama', airport: 'Bahrain International Airport', icao: 'OBBI', iata: 'BAH', latitude: 26.267295, longitude: 50.63764  },
  ],
  Belgium: [
    { id: 'airport:EBBR', city: 'Brussels', airport: 'Brussels Airport', icao: 'EBBR', iata: 'BRU', latitude: 50.901402, longitude: 4.48444  },
    { id: 'airport:EBLG', city: 'Liège', airport: 'Liège Airport', icao: 'EBLG', iata: 'LGG', latitude: 50.638574, longitude: 5.443897  },
    { id: 'airport:EBCI', city: 'Charleroi', airport: 'Brussels South Charleroi Airport', icao: 'EBCI', iata: 'CRL', latitude: 50.461963, longitude: 4.459562  },
  ],
  Brazil: [
    { id: 'airport:SBGR', city: 'São Paulo', airport: 'Guarulhos International Airport', icao: 'SBGR', iata: 'GRU', latitude: -23.431274, longitude: -46.469954  },
    { id: 'airport:SBGL', city: 'Rio de Janeiro', airport: 'Galeão International Airport', icao: 'SBGL', iata: 'GIG', latitude: -22.809999, longitude: -43.250557  },
    { id: 'airport:SBBR', city: 'Brasília', airport: 'Presidente Juscelino Kubitschek International Airport', icao: 'SBBR', iata: 'BSB', latitude: -15.869167, longitude: -47.920834  },
    { id: 'airport:SBCF', city: 'Belo Horizonte', airport: 'Tancredo Neves International Airport', icao: 'SBCF', iata: 'CNF', latitude: -19.63571, longitude: -43.966928  },
    { id: 'airport:SBEG', city: 'Manaus', airport: 'Eduardo Gomes International Airport', icao: 'SBEG', iata: 'MAO', latitude: -3.03861, longitude: -60.049702  },
  ],
  Canada: [
    { id: 'airport:CYYZ', city: 'Toronto', airport: 'Toronto Pearson International Airport', icao: 'CYYZ', iata: 'YYZ', latitude: 43.675935, longitude: -79.629421  },
    { id: 'airport:CYVR', city: 'Vancouver', airport: 'Vancouver International Airport', icao: 'CYVR', iata: 'YVR', latitude: 49.193901, longitude: -123.183998  },
    { id: 'airport:CYUL', city: 'Montréal', airport: 'Montréal–Trudeau International Airport', icao: 'CYUL', iata: 'YUL', latitude: 45.467837, longitude: -73.742294  },
    { id: 'airport:CYYC', city: 'Calgary', airport: 'Calgary International Airport', icao: 'CYYC', iata: 'YYC', latitude: 51.118822, longitude: -114.009933  },
    { id: 'airport:CYOW', city: 'Ottawa', airport: 'Ottawa Macdonald–Cartier International Airport', icao: 'CYOW', iata: 'YOW', latitude: 45.322498, longitude: -75.669197  },
    { id: 'airport:CYEG', city: 'Edmonton', airport: 'Edmonton International Airport', icao: 'CYEG', iata: 'YEG', latitude: 53.3097, longitude: -113.580002  },
  ],
  Chile: [
    { id: 'airport:SCEL', city: 'Santiago', airport: 'Arturo Merino Benítez International Airport', icao: 'SCEL', iata: 'SCL', latitude: -33.393002, longitude: -70.785797  },
    { id: 'airport:SCIE', city: 'Concepción', airport: 'Carriel Sur International Airport', icao: 'SCIE', iata: 'CCP', latitude: -36.77235, longitude: -73.062828  },
    { id: 'airport:SCTE', city: 'Puerto Montt', airport: 'El Tepual Airport', icao: 'SCTE', iata: 'PMC', latitude: -41.443093, longitude: -73.094065  },
  ],
  China: [
    { id: 'airport:ZBAA', city: 'Beijing', airport: 'Beijing Capital International Airport', icao: 'ZBAA', iata: 'PEK', latitude: 40.077349, longitude: 116.596702  },
    { id: 'airport:ZSPD', city: 'Shanghai', airport: 'Shanghai Pudong International Airport', icao: 'ZSPD', iata: 'PVG', latitude: 31.1434, longitude: 121.805  },
    { id: 'airport:ZGGG', city: 'Guangzhou', airport: 'Guangzhou Baiyun International Airport', icao: 'ZGGG', iata: 'CAN', latitude: 23.392401, longitude: 113.299004  },
    { id: 'airport:ZGSZ', city: 'Shenzhen', airport: "Shenzhen Bao'an International Airport", icao: 'ZGSZ', iata: 'SZX', latitude: 22.639474, longitude: 113.803262  },
    { id: 'airport:ZUTF', city: 'Chengdu', airport: 'Chengdu Tianfu International Airport', icao: 'ZUTF', iata: 'TFU', latitude: 30.31252, longitude: 104.441284  },
    { id: 'airport:ZUCK', city: 'Chongqing', airport: 'Chongqing Jiangbei International Airport', icao: 'ZUCK', iata: 'CKG', latitude: 29.712254, longitude: 106.651895  },
  ],
  Colombia: [
    { id: 'airport:SKBO', city: 'Bogotá', airport: 'El Dorado International Airport', icao: 'SKBO', iata: 'BOG', latitude: 4.70159, longitude: -74.1469  },
    { id: 'airport:SKRG', city: 'Medellín', airport: 'José María Córdova International Airport', icao: 'SKRG', iata: 'MDE', latitude: 6.16454, longitude: -75.4231  },
    { id: 'airport:SKCL', city: 'Cali', airport: 'Alfonso Bonilla Aragón International Airport', icao: 'SKCL', iata: 'CLO', latitude: 3.542717, longitude: -76.381898  },
    { id: 'airport:SKCG', city: 'Cartagena', airport: 'Rafael Núñez International Airport', icao: 'SKCG', iata: 'CTG', latitude: 10.4424, longitude: -75.513  },
  ],
  "Côte d'Ivoire": [
    { id: 'airport:DIAP', city: 'Abidjan', airport: 'Félix-Houphouët-Boigny International Airport', icao: 'DIAP', iata: 'ABJ', latitude: 5.26139, longitude: -3.92629  },
    { id: 'airport:DIYO', city: 'Yamoussoukro', airport: 'Yamoussoukro Airport', icao: 'DIYO', iata: 'ASK', latitude: 6.90317, longitude: -5.36558  },
  ],
  Croatia: [
    { id: 'airport:LDZA', city: 'Zagreb', airport: 'Franjo Tuđman Airport', icao: 'LDZA', iata: 'ZAG', latitude: 45.742901, longitude: 16.0688  },
    { id: 'airport:LDSP', city: 'Split', airport: 'Split Airport', icao: 'LDSP', iata: 'SPU', latitude: 43.538898, longitude: 16.298  },
    { id: 'airport:LDDU', city: 'Dubrovnik', airport: 'Dubrovnik Airport', icao: 'LDDU', iata: 'DBV', latitude: 42.562247, longitude: 18.265543  },
  ],
  'Czech Republic': [
    { id: 'airport:LKPR', city: 'Prague', airport: 'Václav Havel Airport Prague', icao: 'LKPR', iata: 'PRG', latitude: 50.100874, longitude: 14.259911  },
    { id: 'airport:LKTB', city: 'Brno', airport: 'Brno-Tuřany Airport', icao: 'LKTB', iata: 'BRQ', latitude: 49.151276, longitude: 16.693972  },
    { id: 'airport:LKMT', city: 'Ostrava', airport: 'Leoš Janáček Airport Ostrava', icao: 'LKMT', iata: 'OSR', latitude: 49.696301, longitude: 18.111099  },
  ],
  Denmark: [
    { id: 'airport:EKCH', city: 'Copenhagen', airport: 'Copenhagen Airport', icao: 'EKCH', iata: 'CPH', latitude: 55.617901, longitude: 12.656  },
    { id: 'airport:EKBI', city: 'Billund', airport: 'Billund Airport', icao: 'EKBI', iata: 'BLL', latitude: 55.740335, longitude: 9.157019  },
    { id: 'airport:EKAH', city: 'Aarhus', airport: 'Aarhus Airport', icao: 'EKAH', iata: 'AAR', latitude: 56.303331, longitude: 10.618286  },
  ],
  Ecuador: [
    { id: 'airport:SEQM', city: 'Quito', airport: 'Mariscal Sucre International Airport', icao: 'SEQM', iata: 'UIO', latitude: -0.125399, longitude: -78.354306  },
    { id: 'airport:SEGU', city: 'Guayaquil', airport: 'José Joaquín de Olmedo International Airport', icao: 'SEGU', iata: 'GYE', latitude: -2.15742, longitude: -79.883598  },
  ],
  Egypt: [
    { id: 'airport:HECA', city: 'Cairo', airport: 'Cairo International Airport', icao: 'HECA', iata: 'CAI', latitude: 30.111534, longitude: 31.396694  },
    { id: 'airport:HELX', city: 'Luxor', airport: 'Luxor International Airport', icao: 'HELX', iata: 'LXR', latitude: 25.671018, longitude: 32.706446  },
    { id: 'airport:HEGN', city: 'Hurghada', airport: 'Hurghada International Airport', icao: 'HEGN', iata: 'HRG', latitude: 27.176776, longitude: 33.796692  },
    { id: 'airport:HEBA', city: 'Alexandria', airport: 'Borg El Arab Airport', icao: 'HEBA', iata: 'HBE', latitude: 30.93249, longitude: 29.696437  },
  ],
  Ethiopia: [
    { id: 'airport:HAAB', city: 'Addis Ababa', airport: 'Bole International Airport', icao: 'HAAB', iata: 'ADD', latitude: 8.97789, longitude: 38.799301  },
    { id: 'airport:HADR', city: 'Dire Dawa', airport: 'Aba Tenna D Yilma International Airport', icao: 'HADR', iata: 'DIR', latitude: 9.623549, longitude: 41.855027  },
  ],
  Finland: [
    { id: 'airport:EFHK', city: 'Helsinki', airport: 'Helsinki–Vantaa Airport', icao: 'EFHK', iata: 'HEL', latitude: 60.318363, longitude: 24.963341  },
    { id: 'airport:EFTP', city: 'Tampere', airport: 'Tampere–Pirkkala Airport', icao: 'EFTP', iata: 'TMP', latitude: 61.414101, longitude: 23.604401  },
    { id: 'airport:EFOU', city: 'Oulu', airport: 'Oulu Airport', icao: 'EFOU', iata: 'OUL', latitude: 64.930099, longitude: 25.354601  },
    { id: 'airport:EFTU', city: 'Turku', airport: 'Turku Airport', icao: 'EFTU', iata: 'TKU', latitude: 60.514099, longitude: 22.2628  },
  ],
  France: [
    { id: 'airport:LFPG', city: 'Paris', airport: 'Charles de Gaulle Airport', icao: 'LFPG', iata: 'CDG', latitude: 49.00896, longitude: 2.554117  },
    { id: 'airport:LFPO', city: 'Paris', airport: 'Orly Airport', icao: 'LFPO', iata: 'ORY', latitude: 48.729499, longitude: 2.358963  },
    { id: 'airport:LFMN', city: 'Nice', airport: 'Nice Côte d\'Azur Airport', icao: 'LFMN', iata: 'NCE', latitude: 43.658401, longitude: 7.21587  },
    { id: 'airport:LFLL', city: 'Lyon', airport: 'Lyon–Saint-Exupéry Airport', icao: 'LFLL', iata: 'LYS', latitude: 45.725996, longitude: 5.090139  },
    { id: 'airport:LFML', city: 'Marseille', airport: 'Marseille Provence Airport', icao: 'LFML', iata: 'MRS', latitude: 43.438088, longitude: 5.2125  },
    { id: 'airport:LFBO', city: 'Toulouse', airport: 'Toulouse–Blagnac Airport', icao: 'LFBO', iata: 'TLS', latitude: 43.629101, longitude: 1.36382  },
    { id: 'airport:LFBD', city: 'Bordeaux', airport: 'Bordeaux–Mérignac Airport', icao: 'LFBD', iata: 'BOD', latitude: 44.82865, longitude: -0.715356  },
  ],
  Germany: [
    { id: 'airport:EDDF', city: 'Frankfurt', airport: 'Frankfurt Airport', icao: 'EDDF', iata: 'FRA', latitude: 50.026706, longitude: 8.55835  },
    { id: 'airport:EDDM', city: 'Munich', airport: 'Munich Airport', icao: 'EDDM', iata: 'MUC', latitude: 48.353802, longitude: 11.7861  },
    { id: 'airport:EDDB', city: 'Berlin', airport: 'Berlin Brandenburg Airport', icao: 'EDDB', iata: 'BER', latitude: 52.361738, longitude: 13.502341  },
    { id: 'airport:EDDL', city: 'Düsseldorf', airport: 'Düsseldorf Airport', icao: 'EDDL', iata: 'DUS', latitude: 51.289501, longitude: 6.76678  },
    { id: 'airport:EDDH', city: 'Hamburg', airport: 'Hamburg Airport', icao: 'EDDH', iata: 'HAM', latitude: 53.630402, longitude: 9.98823  },
    { id: 'airport:EDDK', city: 'Cologne', airport: 'Cologne Bonn Airport', icao: 'EDDK', iata: 'CGN', latitude: 50.865898, longitude: 7.14274  },
    { id: 'airport:EDDS', city: 'Stuttgart', airport: 'Stuttgart Airport', icao: 'EDDS', iata: 'STR', latitude: 48.689899, longitude: 9.22196  },
  ],
  Ghana: [
    { id: 'airport:DGAA', city: 'Accra', airport: 'Kotoka International Airport', icao: 'DGAA', iata: 'ACC', latitude: 5.60519, longitude: -0.166786  },
    { id: 'airport:DGSI', city: 'Kumasi', airport: 'Kumasi Airport', icao: 'DGSI', iata: 'KMS', latitude: 6.71456, longitude: -1.59082  },
  ],
  Greece: [
    { id: 'airport:LGAV', city: 'Athens', airport: 'Athens International Airport Eleftherios Venizelos', icao: 'LGAV', iata: 'ATH', latitude: 37.936401, longitude: 23.9445  },
    { id: 'airport:LGTS', city: 'Thessaloniki', airport: 'Thessaloniki Airport Macedonia', icao: 'LGTS', iata: 'SKG', latitude: 40.51928, longitude: 22.970009  },
    { id: 'airport:LGIR', city: 'Heraklion', airport: 'Heraklion International Airport Nikos Kazantzakis', icao: 'LGIR', iata: 'HER', latitude: 35.339699, longitude: 25.1803  },
    { id: 'airport:LGRP', city: 'Rhodes', airport: 'Rhodes International Airport Diagoras', icao: 'LGRP', iata: 'RHO', latitude: 36.405399, longitude: 28.086201  },
  ],
  'Hong Kong': [
    { id: 'airport:VHHH', city: 'Hong Kong', airport: 'Hong Kong International Airport', icao: 'VHHH', iata: 'HKG', latitude: 22.31184, longitude: 113.914862  },
  ],
  Hungary: [
    { id: 'airport:LHBP', city: 'Budapest', airport: 'Budapest Ferenc Liszt International Airport', icao: 'LHBP', iata: 'BUD', latitude: 47.43018, longitude: 19.262393  },
    { id: 'airport:LHDC', city: 'Debrecen', airport: 'Debrecen International Airport', icao: 'LHDC', iata: 'DEB', latitude: 47.489469, longitude: 21.616278  },
  ],
  India: [
    { id: 'airport:VIDP', city: 'Delhi', airport: 'Indira Gandhi International Airport', icao: 'VIDP', iata: 'DEL', latitude: 28.55563, longitude: 77.09519  },
    { id: 'airport:VABB', city: 'Mumbai', airport: 'Chhatrapati Shivaji Maharaj International Airport', icao: 'VABB', iata: 'BOM', latitude: 19.088699, longitude: 72.867897  },
    { id: 'airport:VOBL', city: 'Bangalore', airport: 'Kempegowda International Airport', icao: 'VOBL', iata: 'BLR', latitude: 13.1979, longitude: 77.706299  },
    { id: 'airport:VOMM', city: 'Chennai', airport: 'Chennai International Airport', icao: 'VOMM', iata: 'MAA', latitude: 12.990005, longitude: 80.169296  },
    { id: 'airport:VOHS', city: 'Hyderabad', airport: 'Rajiv Gandhi International Airport', icao: 'VOHS', iata: 'HYD', latitude: 17.231318, longitude: 78.429855  },
    { id: 'airport:VECC', city: 'Kolkata', airport: 'Netaji Subhas Chandra Bose International Airport', icao: 'VECC', iata: 'CCU', latitude: 22.654012, longitude: 88.44765  },
  ],
  Indonesia: [
    { id: 'airport:WIII', city: 'Jakarta', airport: 'Soekarno–Hatta International Airport', icao: 'WIII', iata: 'CGK', latitude: -6.12557, longitude: 106.655998  },
    { id: 'airport:WADD', city: 'Bali', airport: 'Ngurah Rai International Airport', icao: 'WADD', iata: 'DPS', latitude: -8.748409, longitude: 115.167123  },
    { id: 'airport:WARR', city: 'Surabaya', airport: 'Juanda International Airport', icao: 'WARR', iata: 'SUB', latitude: -7.37983, longitude: 112.787003  },
    { id: 'airport:WIMM', city: 'Medan', airport: 'Kualanamu International Airport', icao: 'WIMM', iata: 'KNO', latitude: 3.637847, longitude: 98.870566  },
  ],
  Ireland: [
    { id: 'airport:EIDW', city: 'Dublin', airport: 'Dublin Airport', icao: 'EIDW', iata: 'DUB', latitude: 53.428713, longitude: -6.262121  },
    { id: 'airport:EICK', city: 'Cork', airport: 'Cork Airport', icao: 'EICK', iata: 'ORK', latitude: 51.841301, longitude: -8.49111  },
    { id: 'airport:EINN', city: 'Shannon', airport: 'Shannon Airport', icao: 'EINN', iata: 'SNN', latitude: 52.702, longitude: -8.92482  },
  ],
  Israel: [
    { id: 'airport:LLBG', city: 'Tel Aviv', airport: 'Ben Gurion International Airport', icao: 'LLBG', iata: 'TLV', latitude: 32.011398, longitude: 34.8867  },
    { id: 'airport:LLET', city: 'Eilat', airport: 'Ramon Airport', icao: 'LLET', iata: 'ETM', latitude: 29.727009, longitude: 35.014116  },
    { id: 'airport:LLHA', city: 'Haifa', airport: 'Haifa Airport', icao: 'LLHA', iata: 'HFA', latitude: 32.810219, longitude: 35.043719  },
  ],
  Italy: [
    { id: 'airport:LIRF', city: 'Rome', airport: 'Leonardo da Vinci–Fiumicino Airport', icao: 'LIRF', iata: 'FCO', latitude: 41.804532, longitude: 12.251998  },
    { id: 'airport:LIMC', city: 'Milan', airport: 'Milan Malpensa Airport', icao: 'LIMC', iata: 'MXP', latitude: 45.6306, longitude: 8.72811  },
    { id: 'airport:LIML', city: 'Milan', airport: 'Milan Linate Airport', icao: 'LIML', iata: 'LIN', latitude: 45.445099, longitude: 9.27674  },
    { id: 'airport:LIPZ', city: 'Venice', airport: 'Venice Marco Polo Airport', icao: 'LIPZ', iata: 'VCE', latitude: 45.505299, longitude: 12.3519  },
    { id: 'airport:LIRN', city: 'Naples', airport: 'Naples International Airport', icao: 'LIRN', iata: 'NAP', latitude: 40.886002, longitude: 14.2908  },
    { id: 'airport:LICC', city: 'Catania', airport: 'Catania Fontanarossa Airport', icao: 'LICC', iata: 'CTA', latitude: 37.466801, longitude: 15.0664  },
    { id: 'airport:LIPE', city: 'Bologna', airport: 'Bologna Guglielmo Marconi Airport', icao: 'LIPE', iata: 'BLQ', latitude: 44.5354, longitude: 11.2887  },
  ],
  Japan: [
    { id: 'airport:RJAA', city: 'Tokyo', airport: 'Narita International Airport', icao: 'RJAA', iata: 'NRT', latitude: 35.76858, longitude: 140.388714  },
    { id: 'airport:RJTT', city: 'Tokyo', airport: 'Tokyo Haneda Airport', icao: 'RJTT', iata: 'HND', latitude: 35.549678, longitude: 139.786958  },
    { id: 'airport:RJBB', city: 'Osaka', airport: 'Kansai International Airport', icao: 'RJBB', iata: 'KIX', latitude: 34.427299, longitude: 135.244003  },
    { id: 'airport:RJGG', city: 'Nagoya', airport: 'Chubu Centrair International Airport', icao: 'RJGG', iata: 'NGO', latitude: 34.858398, longitude: 136.804993  },
    { id: 'airport:RJCC', city: 'Sapporo', airport: 'New Chitose Airport', icao: 'RJCC', iata: 'CTS', latitude: 42.774753, longitude: 141.690414  },
    { id: 'airport:RJFF', city: 'Fukuoka', airport: 'Fukuoka Airport', icao: 'RJFF', iata: 'FUK', latitude: 33.585899, longitude: 130.451004  },
  ],
  Jordan: [
    { id: 'airport:OJAI', city: 'Amman', airport: 'Queen Alia International Airport', icao: 'OJAI', iata: 'AMM', latitude: 31.722601, longitude: 35.993198  },
    { id: 'airport:OJAQ', city: 'Aqaba', airport: 'King Hussein International Airport', icao: 'OJAQ', iata: 'AQJ', latitude: 29.611601, longitude: 35.018101  },
  ],
  Kenya: [
    { id: 'airport:HKJK', city: 'Nairobi', airport: 'Jomo Kenyatta International Airport', icao: 'HKJK', iata: 'NBO', latitude: -1.318886, longitude: 36.928233  },
    { id: 'airport:HKMO', city: 'Mombasa', airport: 'Moi International Airport', icao: 'HKMO', iata: 'MBA', latitude: -4.03483, longitude: 39.5942  },
    { id: 'airport:HKKI', city: 'Kisumu', airport: 'Kisumu International Airport', icao: 'HKKI', iata: 'KIS', latitude: -0.086139, longitude: 34.728901  },
  ],
  Kuwait: [
    { id: 'airport:OKBK', city: 'Kuwait City', airport: 'Kuwait International Airport', icao: 'OKBK', iata: 'KWI', latitude: 29.224487, longitude: 47.969813  },
  ],
  Malaysia: [
    { id: 'airport:WMKK', city: 'Kuala Lumpur', airport: 'Kuala Lumpur International Airport', icao: 'WMKK', iata: 'KUL', latitude: 2.74558, longitude: 101.709999  },
    { id: 'airport:WMKP', city: 'Penang', airport: 'Penang International Airport', icao: 'WMKP', iata: 'PEN', latitude: 5.296303, longitude: 100.276185  },
    { id: 'airport:WBKK', city: 'Kota Kinabalu', airport: 'Kota Kinabalu International Airport', icao: 'WBKK', iata: 'BKI', latitude: 5.932743, longitude: 116.049324  },
    { id: 'airport:WMKJ', city: 'Johor Bahru', airport: 'Senai International Airport', icao: 'WMKJ', iata: 'JHB', latitude: 1.64131, longitude: 103.669998  },
  ],
  Mexico: [
    { id: 'airport:MMMX', city: 'Mexico City', airport: 'Benito Juárez International Airport', icao: 'MMMX', iata: 'MEX', latitude: 19.435822, longitude: -99.07033  },
    { id: 'airport:MMUN', city: 'Cancún', airport: 'Cancún International Airport', icao: 'MMUN', iata: 'CUN', latitude: 21.040817, longitude: -86.87347  },
    { id: 'airport:MMGL', city: 'Guadalajara', airport: 'Miguel Hidalgo y Costilla International Airport', icao: 'MMGL', iata: 'GDL', latitude: 20.523342, longitude: -103.310108  },
    { id: 'airport:MMMY', city: 'Monterrey', airport: 'General Mariano Escobedo International Airport', icao: 'MMMY', iata: 'MTY', latitude: 25.778521, longitude: -100.106989  },
    { id: 'airport:MMTJ', city: 'Tijuana', airport: 'General Abelardo L. Rodríguez International Airport', icao: 'MMTJ', iata: 'TIJ', latitude: 32.541043, longitude: -116.969976  },
  ],
  Morocco: [
    { id: 'airport:GMMN', city: 'Casablanca', airport: 'Mohammed V International Airport', icao: 'GMMN', iata: 'CMN', latitude: 33.3675, longitude: -7.58997  },
    { id: 'airport:GMMX', city: 'Marrakech', airport: 'Menara Airport', icao: 'GMMX', iata: 'RAK', latitude: 31.604807, longitude: -8.035788  },
    { id: 'airport:GMME', city: 'Rabat', airport: 'Rabat–Salé Airport', icao: 'GMME', iata: 'RBA', latitude: 34.051498, longitude: -6.75152  },
    { id: 'airport:GMFF', city: 'Fez', airport: 'Fès–Saïss Airport', icao: 'GMFF', iata: 'FEZ', latitude: 33.927299, longitude: -4.97796  },
  ],
  Netherlands: [
    { id: 'airport:EHAM', city: 'Amsterdam', airport: 'Amsterdam Airport Schiphol', icao: 'EHAM', iata: 'AMS', latitude: 52.308601, longitude: 4.76389  },
    { id: 'airport:EHRD', city: 'Rotterdam', airport: 'Rotterdam The Hague Airport', icao: 'EHRD', iata: 'RTM', latitude: 51.956902, longitude: 4.43722  },
    { id: 'airport:EHEH', city: 'Eindhoven', airport: 'Eindhoven Airport', icao: 'EHEH', iata: 'EIN', latitude: 51.4501, longitude: 5.37453  },
  ],
  'New Zealand': [
    { id: 'airport:NZAA', city: 'Auckland', airport: 'Auckland Airport', icao: 'NZAA', iata: 'AKL', latitude: -37.01199, longitude: 174.786331  },
    { id: 'airport:NZCH', city: 'Christchurch', airport: 'Christchurch International Airport', icao: 'NZCH', iata: 'CHC', latitude: -43.489029, longitude: 172.532065  },
    { id: 'airport:NZWN', city: 'Wellington', airport: 'Wellington International Airport', icao: 'NZWN', iata: 'WLG', latitude: -41.326839, longitude: 174.806862  },
    { id: 'airport:NZQN', city: 'Queenstown', airport: 'Queenstown Airport', icao: 'NZQN', iata: 'ZQN', latitude: -45.019205, longitude: 168.746379  },
  ],
  Nigeria: [
    { id: 'airport:DNMM', city: 'Lagos', airport: 'Murtala Muhammed International Airport', icao: 'DNMM', iata: 'LOS', latitude: 6.57737, longitude: 3.32116  },
    { id: 'airport:DNAA', city: 'Abuja', airport: 'Nnamdi Azikiwe International Airport', icao: 'DNAA', iata: 'ABV', latitude: 9.00679, longitude: 7.26317  },
    { id: 'airport:DNPO', city: 'Port Harcourt', airport: 'Port Harcourt International Airport', icao: 'DNPO', iata: 'PHC', latitude: 5.01549, longitude: 6.94959  },
    { id: 'airport:DNKN', city: 'Kano', airport: 'Mallam Aminu Kano International Airport', icao: 'DNKN', iata: 'KAN', latitude: 12.045613, longitude: 8.523566  },
  ],
  Norway: [
    { id: 'airport:ENGM', city: 'Oslo', airport: 'Oslo Airport, Gardermoen', icao: 'ENGM', iata: 'OSL', latitude: 60.193901, longitude: 11.1004  },
    { id: 'airport:ENBR', city: 'Bergen', airport: 'Bergen Airport, Flesland', icao: 'ENBR', iata: 'BGO', latitude: 60.2934, longitude: 5.21814  },
    { id: 'airport:ENZV', city: 'Stavanger', airport: 'Stavanger Airport, Sola', icao: 'ENZV', iata: 'SVG', latitude: 58.876701, longitude: 5.63778  },
    { id: 'airport:ENVA', city: 'Trondheim', airport: 'Trondheim Airport, Værnes', icao: 'ENVA', iata: 'TRD', latitude: 63.457802, longitude: 10.924  },
  ],
  Pakistan: [
    { id: 'airport:OPKC', city: 'Karachi', airport: 'Jinnah International Airport', icao: 'OPKC', iata: 'KHI', latitude: 24.9065, longitude: 67.160797  },
    { id: 'airport:OPLA', city: 'Lahore', airport: 'Allama Iqbal International Airport', icao: 'OPLA', iata: 'LHE', latitude: 31.521601, longitude: 74.403603  },
    { id: 'airport:OPIS', city: 'Islamabad', airport: 'Islamabad International Airport', icao: 'OPIS', iata: 'ISB', latitude: 33.549, longitude: 72.82566  },
    { id: 'airport:OPPS', city: 'Peshawar', airport: 'Bacha Khan International Airport', icao: 'OPPS', iata: 'PEW', latitude: 33.9939, longitude: 71.514603  },
  ],
  Peru: [
    { id: 'airport:SPJC', city: 'Lima', airport: 'Jorge Chávez International Airport', icao: 'SPJC', iata: 'LIM', latitude: -12.0219, longitude: -77.114305  },
    { id: 'airport:SPZO', city: 'Cusco', airport: 'Alejandro Velasco Astete International Airport', icao: 'SPZO', iata: 'CUZ', latitude: -13.5357, longitude: -71.938797  },
    { id: 'airport:SPQU', city: 'Arequipa', airport: 'Rodríguez Ballón International Airport', icao: 'SPQU', iata: 'AQP', latitude: -16.340786, longitude: -71.569485  },
  ],
  Philippines: [
    { id: 'airport:RPLL', city: 'Manila', airport: 'Ninoy Aquino International Airport', icao: 'RPLL', iata: 'MNL', latitude: 14.5086, longitude: 121.019997  },
    { id: 'airport:RPVM', city: 'Cebu', airport: 'Mactan–Cebu International Airport', icao: 'RPVM', iata: 'CEB', latitude: 10.309261, longitude: 123.97974  },
    { id: 'airport:RPMD', city: 'Davao', airport: 'Francisco Bangoy International Airport', icao: 'RPMD', iata: 'DVO', latitude: 7.12552, longitude: 125.646004  },
    { id: 'airport:RPLC', city: 'Clark', airport: 'Clark International Airport', icao: 'RPLC', iata: 'CRK', latitude: 15.186, longitude: 120.559998  },
  ],
  Poland: [
    { id: 'airport:EPWA', city: 'Warsaw', airport: 'Warsaw Chopin Airport', icao: 'EPWA', iata: 'WAW', latitude: 52.165699, longitude: 20.9671  },
    { id: 'airport:EPKK', city: 'Kraków', airport: 'Kraków John Paul II International Airport', icao: 'EPKK', iata: 'KRK', latitude: 50.077702, longitude: 19.7848  },
    { id: 'airport:EPGD', city: 'Gdańsk', airport: 'Lech Wałęsa Airport Gdańsk', icao: 'EPGD', iata: 'GDN', latitude: 54.377602, longitude: 18.4662  },
    { id: 'airport:EPWR', city: 'Wrocław', airport: 'Copernicus Airport Wrocław', icao: 'EPWR', iata: 'WRO', latitude: 51.103719, longitude: 16.882096  },
    { id: 'airport:EPKT', city: 'Katowice', airport: 'Katowice International Airport', icao: 'EPKT', iata: 'KTW', latitude: 50.476015, longitude: 19.080705  },
  ],
  Portugal: [
    { id: 'airport:LPPT', city: 'Lisbon', airport: 'Humberto Delgado Airport', icao: 'LPPT', iata: 'LIS', latitude: 38.7813, longitude: -9.13592  },
    { id: 'airport:LPPR', city: 'Porto', airport: 'Francisco Sá Carneiro Airport', icao: 'LPPR', iata: 'OPO', latitude: 41.2481, longitude: -8.68139  },
    { id: 'airport:LPFR', city: 'Faro', airport: 'Faro Airport', icao: 'LPFR', iata: 'FAO', latitude: 37.015909, longitude: -7.970939  },
  ],
  Qatar: [
    { id: 'airport:OTHH', city: 'Doha', airport: 'Hamad International Airport', icao: 'OTHH', iata: 'DOH', latitude: 25.273056, longitude: 51.608056  },
  ],
  Romania: [
    { id: 'airport:LROP', city: 'Bucharest', airport: 'Henri Coandă International Airport', icao: 'LROP', iata: 'OTP', latitude: 44.571792, longitude: 26.103285  },
    { id: 'airport:LRCL', city: 'Cluj-Napoca', airport: 'Cluj-Napoca International Airport', icao: 'LRCL', iata: 'CLJ', latitude: 46.786042, longitude: 23.685733  },
    { id: 'airport:LRTR', city: 'Timișoara', airport: 'Timișoara Traian Vuia International Airport', icao: 'LRTR', iata: 'TSR', latitude: 45.809898, longitude: 21.3379  },
  ],
  Russia: [
    { id: 'airport:UUEE', city: 'Moscow', airport: 'Sheremetyevo International Airport', icao: 'UUEE', iata: 'SVO', latitude: 55.976858, longitude: 37.41121  },
    { id: 'airport:UUDD', city: 'Moscow', airport: 'Domodedovo International Airport', icao: 'UUDD', iata: 'DME', latitude: 55.408798, longitude: 37.9063  },
    { id: 'airport:ULLI', city: 'Saint Petersburg', airport: 'Pulkovo Airport', icao: 'ULLI', iata: 'LED', latitude: 59.800301, longitude: 30.262501  },
    { id: 'airport:UNNT', city: 'Novosibirsk', airport: 'Tolmachevo Airport', icao: 'UNNT', iata: 'OVB', latitude: 55.019756, longitude: 82.618675  },
    { id: 'airport:USSS', city: 'Yekaterinburg', airport: 'Koltsovo Airport', icao: 'USSS', iata: 'SVX', latitude: 56.743099, longitude: 60.8027  },
  ],
  'Saudi Arabia': [
    { id: 'airport:OERK', city: 'Riyadh', airport: 'King Khalid International Airport', icao: 'OERK', iata: 'RUH', latitude: 24.9576, longitude: 46.698799  },
    { id: 'airport:OEJN', city: 'Jeddah', airport: 'King Abdulaziz International Airport', icao: 'OEJN', iata: 'JED', latitude: 21.680241, longitude: 39.157436  },
    { id: 'airport:OEDF', city: 'Dammam', airport: 'King Fahd International Airport', icao: 'OEDF', iata: 'DMM', latitude: 26.4691, longitude: 49.798209  },
    { id: 'airport:OEMA', city: 'Medina', airport: 'Prince Mohammad Bin Abdulaziz Airport', icao: 'OEMA', iata: 'MED', latitude: 24.5534, longitude: 39.705101  },
  ],
  Singapore: [
    { id: 'airport:WSSS', city: 'Singapore', airport: 'Singapore Changi Airport', icao: 'WSSS', iata: 'SIN', latitude: 1.35019, longitude: 103.994003  },
  ],
  'South Africa': [
    { id: 'airport:FAOR', city: 'Johannesburg', airport: 'O.R. Tambo International Airport', icao: 'FAOR', iata: 'JNB', latitude: -26.140081, longitude: 28.246801  },
    { id: 'airport:FACT', city: 'Cape Town', airport: 'Cape Town International Airport', icao: 'FACT', iata: 'CPT', latitude: -33.97403, longitude: 18.604333  },
    { id: 'airport:FALE', city: 'Durban', airport: 'King Shaka International Airport', icao: 'FALE', iata: 'DUR', latitude: -29.614444, longitude: 31.119722  },
    { id: 'airport:FAWB', city: 'Pretoria', airport: 'Wonderboom Airport', icao: 'FAWB', iata: 'PRY', latitude: -25.6539, longitude: 28.224199  },
  ],
  'South Korea': [
    { id: 'airport:RKSI', city: 'Seoul', airport: 'Incheon International Airport', icao: 'RKSI', iata: 'ICN', latitude: 37.469101, longitude: 126.450996  },
    { id: 'airport:RKSS', city: 'Seoul', airport: 'Gimpo International Airport', icao: 'RKSS', iata: 'GMP', latitude: 37.5583, longitude: 126.791  },
    { id: 'airport:RKPK', city: 'Busan', airport: 'Gimhae International Airport', icao: 'RKPK', iata: 'PUS', latitude: 35.179501, longitude: 128.938004  },
    { id: 'airport:RKPC', city: 'Jeju', airport: 'Jeju International Airport', icao: 'RKPC', iata: 'CJU', latitude: 33.512058, longitude: 126.492548  },
  ],
  Spain: [
    { id: 'airport:LEMD', city: 'Madrid', airport: 'Adolfo Suárez Madrid–Barajas Airport', icao: 'LEMD', iata: 'MAD', latitude: 40.493407, longitude: -3.572249  },
    { id: 'airport:LEBL', city: 'Barcelona', airport: 'Josep Tarradellas Barcelona–El Prat Airport', icao: 'LEBL', iata: 'BCN', latitude: 41.2971, longitude: 2.07846  },
    { id: 'airport:LEPA', city: 'Palma de Mallorca', airport: 'Palma de Mallorca Airport', icao: 'LEPA', iata: 'PMI', latitude: 39.551701, longitude: 2.73881  },
    { id: 'airport:LEMG', city: 'Málaga', airport: 'Málaga–Costa del Sol Airport', icao: 'LEMG', iata: 'AGP', latitude: 36.6749, longitude: -4.49911  },
    { id: 'airport:LEAL', city: 'Alicante', airport: 'Alicante–Elche Miguel Hernández Airport', icao: 'LEAL', iata: 'ALC', latitude: 38.2822, longitude: -0.558156  },
    { id: 'airport:LEVC', city: 'Valencia', airport: 'Valencia Airport', icao: 'LEVC', iata: 'VLC', latitude: 39.489162, longitude: -0.480961  },
    { id: 'airport:LEZL', city: 'Seville', airport: 'Seville Airport', icao: 'LEZL', iata: 'SVQ', latitude: 37.417999, longitude: -5.89311  },
    { id: 'airport:LEBB', city: 'Bilbao', airport: 'Bilbao Airport', icao: 'LEBB', iata: 'BIO', latitude: 43.301102, longitude: -2.91061  },
  ],
  Sweden: [
    { id: 'airport:ESSA', city: 'Stockholm', airport: 'Stockholm Arlanda Airport', icao: 'ESSA', iata: 'ARN', latitude: 59.64849, longitude: 17.928829  },
    { id: 'airport:ESGG', city: 'Gothenburg', airport: 'Gothenburg Landvetter Airport', icao: 'ESGG', iata: 'GOT', latitude: 57.6628, longitude: 12.2798  },
    { id: 'airport:ESMS', city: 'Malmö', airport: 'Malmö Airport', icao: 'ESMS', iata: 'MMX', latitude: 55.535564, longitude: 13.376327  },
  ],
  Switzerland: [
    { id: 'airport:LSZH', city: 'Zurich', airport: 'Zurich Airport', icao: 'LSZH', iata: 'ZRH', latitude: 47.458056, longitude: 8.548056  },
    { id: 'airport:LSGG', city: 'Geneva', airport: 'Geneva Airport', icao: 'LSGG', iata: 'GVA', latitude: 46.238098, longitude: 6.10895  },
    { id: 'airport:LFSB', city: 'Basel', airport: 'EuroAirport Basel Mulhouse Freiburg', icao: 'LFSB', iata: 'BSL', latitude: 47.60068, longitude: 7.521117  },
  ],
  Taiwan: [
    { id: 'airport:RCTP', city: 'Taipei', airport: 'Taiwan Taoyuan International Airport', icao: 'RCTP', iata: 'TPE', latitude: 25.0777, longitude: 121.233002  },
    { id: 'airport:RCSS', city: 'Taipei', airport: 'Taipei Songshan Airport', icao: 'RCSS', iata: 'TSA', latitude: 25.067244, longitude: 121.552822  },
    { id: 'airport:RCKH', city: 'Kaohsiung', airport: 'Kaohsiung International Airport', icao: 'RCKH', iata: 'KHH', latitude: 22.577101, longitude: 120.349998  },
  ],
  Thailand: [
    { id: 'airport:VTBS', city: 'Bangkok', airport: 'Suvarnabhumi Airport', icao: 'VTBS', iata: 'BKK', latitude: 13.6811, longitude: 100.747002  },
    { id: 'airport:VTBD', city: 'Bangkok', airport: 'Don Mueang International Airport', icao: 'VTBD', iata: 'DMK', latitude: 13.9126, longitude: 100.607002  },
    { id: 'airport:VTCC', city: 'Chiang Mai', airport: 'Chiang Mai International Airport', icao: 'VTCC', iata: 'CNX', latitude: 18.7668, longitude: 98.962601  },
    { id: 'airport:VTSP', city: 'Phuket', airport: 'Phuket International Airport', icao: 'VTSP', iata: 'HKT', latitude: 8.113257, longitude: 98.3174  },
  ],
  Turkey: [
    { id: 'airport:LTFM', city: 'Istanbul', airport: 'Istanbul Airport', icao: 'LTFM', iata: 'IST', latitude: 41.274874, longitude: 28.732136  },
    { id: 'airport:LTFJ', city: 'Istanbul', airport: 'Sabiha Gökçen International Airport', icao: 'LTFJ', iata: 'SAW', latitude: 40.898602, longitude: 29.3092  },
    { id: 'airport:LTAC', city: 'Ankara', airport: 'Esenboğa Airport', icao: 'LTAC', iata: 'ESB', latitude: 40.128101, longitude: 32.995098  },
    { id: 'airport:LTBJ', city: 'Izmir', airport: 'Adnan Menderes Airport', icao: 'LTBJ', iata: 'ADB', latitude: 38.2924, longitude: 27.157  },
    { id: 'airport:LTAI', city: 'Antalya', airport: 'Antalya Airport', icao: 'LTAI', iata: 'AYT', latitude: 36.898701, longitude: 30.800501  },
  ],
  Ukraine: [
    { id: 'airport:UKBB', city: 'Kyiv', airport: 'Boryspil International Airport', icao: 'UKBB', iata: 'KBP', latitude: 50.345001, longitude: 30.894699  },
    { id: 'airport:UKLL', city: 'Lviv', airport: 'Lviv Danylo Halytskyi International Airport', icao: 'UKLL', iata: 'LWO', latitude: 49.8125, longitude: 23.9561  },
    { id: 'airport:UKOO', city: 'Odessa', airport: 'Odessa International Airport', icao: 'UKOO', iata: 'ODS', latitude: 46.427196, longitude: 30.672649  },
    { id: 'airport:UKHH', city: 'Kharkiv', airport: 'Kharkiv International Airport', icao: 'UKHH', iata: 'HRK', latitude: 49.926943, longitude: 36.290814  },
  ],
  'United Arab Emirates': [
    { id: 'airport:OMDB', city: 'Dubai', airport: 'Dubai International Airport', icao: 'OMDB', iata: 'DXB', latitude: 25.24979, longitude: 55.370992  },
    { id: 'airport:OMAA', city: 'Abu Dhabi', airport: 'Abu Dhabi International Airport', icao: 'OMAA', iata: 'AUH', latitude: 24.440966, longitude: 54.649237  },
    { id: 'airport:OMDW', city: 'Dubai', airport: 'Al Maktoum International Airport', icao: 'OMDW', iata: 'DWC', latitude: 24.896171, longitude: 55.16235  },
    { id: 'airport:OMSJ', city: 'Sharjah', airport: 'Sharjah International Airport', icao: 'OMSJ', iata: 'SHJ', latitude: 25.3286, longitude: 55.5172  },
  ],
  'United Kingdom': [
    { id: 'airport:EGLL', city: 'London', airport: 'Heathrow Airport', icao: 'EGLL', iata: 'LHR', latitude: 51.470748, longitude: -0.459909  },
    { id: 'airport:EGKK', city: 'London', airport: 'Gatwick Airport', icao: 'EGKK', iata: 'LGW', latitude: 51.148744, longitude: -0.185739  },
    { id: 'airport:EGSS', city: 'London', airport: 'Stansted Airport', icao: 'EGSS', iata: 'STN', latitude: 51.884998, longitude: 0.235  },
    { id: 'airport:EGCC', city: 'Manchester', airport: 'Manchester Airport', icao: 'EGCC', iata: 'MAN', latitude: 53.349375, longitude: -2.279521  },
    { id: 'airport:EGBB', city: 'Birmingham', airport: 'Birmingham Airport', icao: 'EGBB', iata: 'BHX', latitude: 52.453899, longitude: -1.74803  },
    { id: 'airport:EGPH', city: 'Edinburgh', airport: 'Edinburgh Airport', icao: 'EGPH', iata: 'EDI', latitude: 55.950145, longitude: -3.372288  },
    { id: 'airport:EGPF', city: 'Glasgow', airport: 'Glasgow Airport', icao: 'EGPF', iata: 'GLA', latitude: 55.871899, longitude: -4.43306  },
    { id: 'airport:EGGD', city: 'Bristol', airport: 'Bristol Airport', icao: 'EGGD', iata: 'BRS', latitude: 51.382326, longitude: -2.716453  },
  ],
  'United States': [
    { id: 'airport:KATL', city: 'Atlanta', airport: 'Hartsfield-Jackson Atlanta International Airport', icao: 'KATL', iata: 'ATL', latitude: 33.6367, longitude: -84.428101  },
    { id: 'airport:KPAE', city: 'Everett', airport: 'Paine Field', icao: 'KPAE', iata: 'PAE', latitude: 47.9063, longitude: -122.2816  },
    { id: 'airport:KLAX', city: 'Los Angeles', airport: 'Los Angeles International Airport', icao: 'KLAX', iata: 'LAX', latitude: 33.942501, longitude: -118.407997  },
    { id: 'airport:KORD', city: 'Chicago', airport: "O'Hare International Airport", icao: 'KORD', iata: 'ORD', latitude: 41.9786, longitude: -87.9048  },
    { id: 'airport:KDFW', city: 'Dallas', airport: 'Dallas/Fort Worth International Airport', icao: 'KDFW', iata: 'DFW', latitude: 32.896801, longitude: -97.038002  },
    { id: 'airport:KJFK', city: 'New York', airport: 'John F. Kennedy International Airport', icao: 'KJFK', iata: 'JFK', latitude: 40.639447, longitude: -73.779317  },
    { id: 'airport:KEWR', city: 'New York', airport: 'Newark Liberty International Airport', icao: 'KEWR', iata: 'EWR', latitude: 40.6894, longitude: -74.170545  },
    { id: 'airport:KMIA', city: 'Miami', airport: 'Miami International Airport', icao: 'KMIA', iata: 'MIA', latitude: 25.796011, longitude: -80.289751  },
    { id: 'airport:KSFO', city: 'San Francisco', airport: 'San Francisco International Airport', icao: 'KSFO', iata: 'SFO', latitude: 37.619806, longitude: -122.374821  },
    { id: 'airport:KSEA', city: 'Seattle', airport: 'Seattle–Tacoma International Airport', icao: 'KSEA', iata: 'SEA', latitude: 47.447943, longitude: -122.310276  },
    { id: 'airport:KIAH', city: 'Houston', airport: 'George Bush Intercontinental Airport', icao: 'KIAH', iata: 'IAH', latitude: 29.9844, longitude: -95.3414  },
    { id: 'airport:KDEN', city: 'Denver', airport: 'Denver International Airport', icao: 'KDEN', iata: 'DEN', latitude: 39.860027, longitude: -104.673792  },
    { id: 'airport:KPHX', city: 'Phoenix', airport: 'Phoenix Sky Harbor International Airport', icao: 'KPHX', iata: 'PHX', latitude: 33.435302, longitude: -112.005905  },
    { id: 'airport:KSDL', city: 'Scottsdale', airport: 'Scottsdale Airport', icao: 'KSDL', iata: 'SCF', latitude: 33.6229, longitude: -111.9102  },
    { id: 'airport:KMSP', city: 'Minneapolis', airport: 'Minneapolis–Saint Paul International Airport', icao: 'KMSP', iata: 'MSP', latitude: 44.880081, longitude: -93.221741  },
    { id: 'airport:KDTW', city: 'Detroit', airport: 'Detroit Metropolitan Wayne County Airport', icao: 'KDTW', iata: 'DTW', latitude: 42.21377, longitude: -83.353786  },
  ],
  Uruguay: [
    { id: 'airport:SUMU', city: 'Montevideo', airport: 'Carrasco International Airport', icao: 'SUMU', iata: 'MVD', latitude: -34.835647, longitude: -56.026497  },
  ],
  Venezuela: [
    { id: 'airport:SVMI', city: 'Caracas', airport: 'Simón Bolívar International Airport', icao: 'SVMI', iata: 'CCS', latitude: 10.602214, longitude: -66.991174  },
    { id: 'airport:SVMC', city: 'Maracaibo', airport: 'La Chinita International Airport', icao: 'SVMC', iata: 'MAR', latitude: 10.557542, longitude: -71.729307  },
    { id: 'airport:SVVA', city: 'Valencia', airport: 'Arturo Michelena International Airport', icao: 'SVVA', iata: 'VLN', latitude: 10.149733, longitude: -67.928398  },
  ],
};

export function getCitiesForCountry(countryName: string): AirportCity[] {
  return LOCATION_CITIES[normalizeCountryName(countryName)] ?? [];
}

export const LOCATION_CITY_INDEX: AirportCityWithCountry[] = Object.entries(LOCATION_CITIES).flatMap(
  ([countryName, cities]) => cities.map((city) => ({ ...city, countryName })),
);

const LOCATION_BY_ID = new Map<string, AirportCityWithCountry>(
  LOCATION_CITY_INDEX.map((entry) => [entry.id.toLowerCase(), entry]),
);

const LOCATION_BY_AIRPORT_CODE = LOCATION_CITY_INDEX.reduce((map, entry) => {
  map.set(entry.icao.toLowerCase(), entry);
  if (entry.iata) map.set(entry.iata.toLowerCase(), entry);
  return map;
}, new Map<string, AirportCityWithCountry>());

function normalizeAirportCode(code?: string): string {
  return code?.trim().toLowerCase() ?? '';
}

export function findAirportCityById(locationCityId?: string): AirportCityWithCountry | undefined {
  if (!locationCityId) return undefined;
  return LOCATION_BY_ID.get(locationCityId.trim().toLowerCase());
}

export function findAirportCityByCode(code?: string): AirportCityWithCountry | undefined {
  const normalizedCode = normalizeAirportCode(code);
  if (!normalizedCode) return undefined;
  return LOCATION_BY_AIRPORT_CODE.get(normalizedCode);
}

export function findCityForCountry(countryName: string, cityName: string, baseAirport?: string): AirportCityWithCountry | undefined {
  const normalizedCountry = normalizeCountryName(countryName);
  const normalizedCity = cityName.trim().toLowerCase();
  const matches = getCitiesForCountry(normalizedCountry)
    .map((entry) => ({ ...entry, countryName: normalizedCountry }))
    .filter((entry) => entry.city.toLowerCase() === normalizedCity);

  if (baseAirport) {
    const normalizedAirport = normalizeAirportCode(baseAirport);
    const airportMatch = matches.find(
      (entry) => entry.icao.toLowerCase() === normalizedAirport || entry.iata.toLowerCase() === normalizedAirport,
    );
    if (airportMatch) return airportMatch;
  }

  return matches[0];
}

export function resolveAirportCity(reference: LocationReference): AirportCityWithCountry | undefined {
  const byId = findAirportCityById(reference.locationCityId);
  if (byId) return byId;

  const byAirport = findAirportCityByCode(reference.baseAirport);
  if (byAirport) return byAirport;

  if (reference.country && reference.city) {
    return findCityForCountry(reference.country, reference.city, reference.baseAirport);
  }

  return undefined;
}

export function toLocationSnapshot(entry: AirportCityWithCountry): LocationSnapshot {
  return {
    locationCityId: entry.id,
    country: entry.countryName,
    city: entry.city,
    baseAirport: entry.iata || entry.icao,
    latitude: entry.latitude,
    longitude: entry.longitude,
  };
}

export function resolveLocationSnapshot(reference: LocationReference): LocationSnapshot | undefined {
  const entry = resolveAirportCity(reference);
  return entry ? toLocationSnapshot(entry) : undefined;
}
