// Address + GSTIN validators shared by the invoice, client and settings forms.
// Every validator returns { ok, message }. An empty value is ok - these fields
// are optional - so callers decide separately whether a field is required.

import { decodeGstin, gstinChecksumOk } from '../utils.js';

// Major cities per country. A city is accepted only if it is listed for the
// selected country; countries without a list (and "Other") accept free text.
export const CITIES_BY_COUNTRY = {
  India: [
    'Agartala','Agra','Ahmedabad','Ahmednagar','Aizawl','Ajmer','Akola','Aligarh','Allahabad','Prayagraj','Alappuzha','Alwar','Ambala','Amravati','Amritsar','Anand','Anantapur','Asansol','Aurangabad','Chhatrapati Sambhajinagar','Ayodhya',
    'Bareilly','Bathinda','Belagavi','Belgaum','Bengaluru','Bangalore','Bhagalpur','Bharuch','Bhavnagar','Bhilai','Bhilwara','Bhiwandi','Bhopal','Bhubaneswar','Bikaner','Bilaspur','Bokaro','Bokaro Steel City',
    'Chandigarh','Chennai','Coimbatore','Cuttack','Dehradun','Delhi','New Delhi','Dhanbad','Dibrugarh','Durgapur','Davanagere','Dindigul',
    'Erode','Faridabad','Firozabad','Gandhinagar','Gangtok','Gaya','Ghaziabad','Gorakhpur','Gurugram','Gurgaon','Guntur','Guwahati','Gwalior',
    'Haridwar','Hisar','Howrah','Hubballi','Hubli','Hyderabad','Imphal','Indore','Itanagar','Jabalpur','Jaipur','Jalandhar','Jalgaon','Jammu','Jamnagar','Jamshedpur','Jhansi','Jodhpur','Junagadh',
    'Kakinada','Kalyan','Kanpur','Karnal','Kochi','Cochin','Kohima','Kolhapur','Kolkata','Kollam','Kota','Kottayam','Kozhikode','Calicut','Kurnool','Latur','Lucknow','Ludhiana',
    'Madurai','Malappuram','Mangaluru','Mangalore','Mathura','Meerut','Moradabad','Mumbai','Navi Mumbai','Muzaffarpur','Mysuru','Mysore',
    'Nagpur','Nanded','Nashik','Nellore','Noida','Greater Noida','Palakkad','Panaji','Panipat','Patiala','Patna','Pimpri-Chinchwad','Pondicherry','Puducherry','Pune','Raipur','Rajkot','Ranchi','Ratlam','Rohtak','Rourkela',
    'Saharanpur','Salem','Sangli','Satara','Shillong','Shimla','Siliguri','Silvassa','Solapur','Srinagar','Surat','Thane','Thanjavur','Thiruvananthapuram','Trivandrum','Thrissur','Tiruchirappalli','Trichy','Tirunelveli','Tirupati','Tiruppur',
    'Udaipur','Ujjain','Vadodara','Baroda','Varanasi','Vasai-Virar','Vellore','Vijayawada','Visakhapatnam','Vizag','Warangal','Yamunanagar',
    'Anklesvar','Ankleshwar','Vapi','Valsad','Navsari','Morbi','Mehsana','Palanpur','Gandhidham','Porbandar','Surendranagar','Amreli','Bhuj','Nadiad','Godhra','Dahod','Kalol','Botad','Veraval','Himatnagar',
  ],
  'United Arab Emirates': ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al Quwain','Ras Al Khaimah','Fujairah','Al Ain'],
  'United States': ['New York','Los Angeles','Chicago','Houston','Phoenix','Philadelphia','San Antonio','San Diego','Dallas','San Jose','Austin','Jacksonville','Fort Worth','Columbus','Charlotte','San Francisco','Indianapolis','Seattle','Denver','Washington','Boston','El Paso','Nashville','Detroit','Oklahoma City','Portland','Las Vegas','Memphis','Louisville','Baltimore','Milwaukee','Albuquerque','Tucson','Fresno','Sacramento','Kansas City','Atlanta','Miami','Raleigh','Omaha','Minneapolis','Tampa','Orlando','Pittsburgh','Cincinnati','Cleveland','Salt Lake City','St. Louis','New Orleans','Honolulu'],
  'United Kingdom': ['London','Birmingham','Manchester','Glasgow','Liverpool','Leeds','Sheffield','Edinburgh','Bristol','Cardiff','Belfast','Leicester','Coventry','Nottingham','Newcastle upon Tyne','Southampton','Portsmouth','Brighton','Oxford','Cambridge','Aberdeen','Dundee','Swansea','Derby','Plymouth','Reading','York','Bath','Norwich','Exeter'],
  Australia: ['Sydney','Melbourne','Brisbane','Perth','Adelaide','Gold Coast','Canberra','Newcastle','Wollongong','Hobart','Geelong','Townsville','Cairns','Darwin','Toowoomba','Ballarat','Bendigo','Launceston'],
  Canada: ['Toronto','Montreal','Vancouver','Calgary','Edmonton','Ottawa','Winnipeg','Quebec City','Hamilton','Kitchener','London','Victoria','Halifax','Oshawa','Windsor','Saskatoon','Regina','St. John\'s','Mississauga','Brampton','Surrey','Laval','Markham'],
  Singapore: ['Singapore'],
  Malaysia: ['Kuala Lumpur','George Town','Ipoh','Johor Bahru','Shah Alam','Petaling Jaya','Kuching','Kota Kinabalu','Malacca','Melaka','Putrajaya','Seremban','Kuantan','Alor Setar'],
  Germany: ['Berlin','Hamburg','Munich','Cologne','Frankfurt','Stuttgart','Düsseldorf','Dortmund','Essen','Leipzig','Bremen','Dresden','Hanover','Nuremberg','Duisburg','Bochum','Wuppertal','Bielefeld','Bonn','Münster','Karlsruhe','Mannheim','Augsburg','Wiesbaden'],
  France: ['Paris','Marseille','Lyon','Toulouse','Nice','Nantes','Strasbourg','Montpellier','Bordeaux','Lille','Rennes','Reims','Toulon','Grenoble','Dijon','Angers','Nîmes','Le Havre'],
  Netherlands: ['Amsterdam','Rotterdam','The Hague','Utrecht','Eindhoven','Groningen','Tilburg','Almere','Breda','Nijmegen','Haarlem','Arnhem','Maastricht','Leiden','Delft'],
  'South Africa': ['Johannesburg','Cape Town','Durban','Pretoria','Port Elizabeth','Gqeberha','Bloemfontein','East London','Pietermaritzburg','Polokwane','Nelspruit','Kimberley','Soweto','Stellenbosch'],
  Nigeria: ['Lagos','Abuja','Kano','Ibadan','Port Harcourt','Benin City','Kaduna','Enugu','Jos','Ilorin','Abeokuta','Onitsha','Warri','Owerri','Calabar'],
  Kenya: ['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Thika','Malindi','Kitale','Garissa'],
  'Saudi Arabia': ['Riyadh','Jeddah','Mecca','Medina','Dammam','Khobar','Taif','Tabuk','Buraidah','Abha','Jubail','Yanbu','Hail'],
  Nepal: ['Kathmandu','Pokhara','Lalitpur','Bharatpur','Biratnagar','Birgunj','Janakpur','Butwal','Dharan','Hetauda','Bhaktapur','Nepalgunj'],
  Bangladesh: ['Dhaka','Chittagong','Chattogram','Khulna','Rajshahi','Sylhet','Barisal','Rangpur','Comilla','Narayanganj','Gazipur','Mymensingh'],
  'Sri Lanka': ['Colombo','Kandy','Galle','Jaffna','Negombo','Trincomalee','Batticaloa','Matara','Kurunegala','Anuradhapura','Ratnapura'],
  Pakistan: ['Karachi','Lahore','Islamabad','Rawalpindi','Faisalabad','Multan','Peshawar','Quetta','Hyderabad','Gujranwala','Sialkot','Bahawalpur','Sargodha'],
  Philippines: ['Manila','Quezon City','Davao','Cebu City','Zamboanga','Makati','Taguig','Pasig','Cagayan de Oro','Baguio','Iloilo City','Bacolod'],
  Indonesia: ['Jakarta','Surabaya','Bandung','Medan','Semarang','Makassar','Palembang','Tangerang','Depok','Bekasi','Denpasar','Yogyakarta','Malang','Bogor','Balikpapan'],
  'New Zealand': ['Auckland','Wellington','Christchurch','Hamilton','Tauranga','Dunedin','Palmerston North','Napier','Nelson','Rotorua','Queenstown','Invercargill'],
};

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

export const getCitiesForCountry = (country) => CITIES_BY_COUNTRY[country] || [];

// City must belong to the selected country (when we hold a list for it).
export const validateCity = (country, city) => {
  const value = String(city || '').trim();
  if (!value) return { ok: true, message: '' };
  if (!/^[\p{L}][\p{L}\s.'()-]*$/u.test(value)) {
    return { ok: false, message: 'City can contain only letters, spaces, . \' ( ) and -.' };
  }
  const list = getCitiesForCountry(country);
  if (list.length === 0) return { ok: true, message: '' };
  const wanted = norm(value);
  return list.some(c => norm(c) === wanted)
    ? { ok: true, message: '' }
    : { ok: false, message: `"${value}" is not a listed city in ${country}. Pick one from the suggestions.` };
};

// India: exactly 6 digits, first digit 1-9. Other countries keep their own free format.
export const validatePin = (country, pin) => {
  const value = String(pin || '').trim();
  if (!value) return { ok: true, message: '' };
  if ((country || 'India') !== 'India') return { ok: true, message: '' };
  if (!/^\d+$/.test(value)) return { ok: false, message: 'PIN code must contain digits only.' };
  if (value.length !== 6) return { ok: false, message: 'PIN code must be exactly 6 digits.' };
  if (value[0] === '0') return { ok: false, message: 'PIN code cannot start with 0.' };
  return { ok: true, message: '' };
};

// GSTIN, position by position:
//   1-2   state code, numeric 01-38
//   3-12  PAN: 5 letters, 4 digits, 1 letter
//   13    entity number within the state, 1-9 or A-Z (never 0)
//   14    default character, any letter or digit (normally Z)
//   15    check digit, mod-36
export const validateGstin = (value) => {
  const gstin = String(value || '').trim().toUpperCase();
  if (!gstin) return { ok: true, message: '' };
  if (gstin.length !== 15) return { ok: false, message: 'GSTIN must be exactly 15 characters.' };
  if (!/^[A-Z0-9]+$/.test(gstin)) return { ok: false, message: 'GSTIN can contain only letters and digits.' };
  const code = Number(gstin.slice(0, 2));
  if (!/^\d{2}$/.test(gstin.slice(0, 2)) || code < 1 || code > 38) {
    return { ok: false, message: 'GSTIN characters 1-2 must be a state code from 01 to 38.' };
  }
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(gstin.slice(2, 12))) {
    return { ok: false, message: 'GSTIN characters 3-12 must be a PAN: 5 letters, 4 digits, 1 letter.' };
  }
  if (!/^[1-9A-Z]$/.test(gstin[12])) {
    return { ok: false, message: 'GSTIN character 13 must be 1-9 or A-Z.' };
  }
  if (!gstinChecksumOk(gstin)) {
    return { ok: false, message: 'GSTIN check digit (character 15) is wrong - check for a typo.' };
  }
  return { ok: true, message: '', decoded: decodeGstin(gstin) };
};

// All three checks for one form. Returns the message for each failing field
// ('' when fine). GSTIN is only checked for India; other countries keep the
// softer per-country tax ID check in utils.validateTaxId.
export const getAddressErrors = (country, { city, pin, gstin }) => {
  const c = country || 'India';
  return {
    city: validateCity(c, city).message,
    pin: validatePin(c, pin).message,
    gstin: c === 'India' ? validateGstin(gstin).message : '',
  };
};
export const hasAddressErrors = (errors) => Object.values(errors).some(Boolean);

// Phone: digits plus the usual separators (+ at the start, spaces, - . ( )).
// Letters and any other character are rejected. Empty is ok.
export const validatePhone = (value) => {
  const v = String(value || '').trim();
  if (!v) return { ok: true, message: '' };
  if (/\p{L}/u.test(v)) return { ok: false, message: 'Phone number cannot contain letters.' };
  if (!/^\+?[\d\s().-]+$/.test(v)) return { ok: false, message: 'Phone number can contain only digits, spaces, + at the start, and - . ( ).' };
  if (!/\d/.test(v)) return { ok: false, message: 'Phone number must contain digits.' };
  return { ok: true, message: '' };
};

// Email: one address, a dotted domain with a 2+ letter ending, no spaces. Empty is ok.
export const validateEmail = (value) => {
  const v = String(value || '').trim();
  if (!v) return { ok: true, message: '' };
  if (v.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(v) || /\.\./.test(v) || v.startsWith('.') || v.split('@')[0].endsWith('.')) {
    return { ok: false, message: 'Enter a valid email address, like name@example.com.' };
  }
  return { ok: true, message: '' };
};

const isRealIsoDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
};

// India (GST Rule 46): at most 16 characters, letters, digits, "/" and "-" only.
// Other countries: up to 30 characters, no spaces-only or control characters.
export const validateInvoiceNumber = (value, country) => {
  const v = String(value || '').trim();
  if (!v) return { ok: false, message: 'Invoice number is required.' };
  if ((country || 'India') === 'India') {
    if (v.length > 16) return { ok: false, message: 'Invoice number can be at most 16 characters (GST Rule 46).' };
    if (!/^[A-Za-z0-9/-]+$/.test(v)) return { ok: false, message: 'Invoice number can contain only letters, digits, "/" and "-".' };
  } else {
    if (v.length > 30) return { ok: false, message: 'Invoice number can be at most 30 characters.' };
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(v)) return { ok: false, message: 'Invoice number has invalid characters.' };
  }
  return { ok: true, message: '' };
};

// Required, a real calendar date, not in the future, not before GST began
// (1 Jul 2017) for India. `today` is a YYYY-MM-DD string.
export const validateInvoiceDate = (value, country, today) => {
  if (!value) return { ok: false, message: 'Invoice date is required.' };
  if (!isRealIsoDate(value)) return { ok: false, message: 'Enter a valid invoice date.' };
  if (today && value > today) return { ok: false, message: 'Invoice date cannot be in the future.' };
  if ((country || 'India') === 'India' && value < '2017-07-01') return { ok: false, message: 'Invoice date cannot be before 1 July 2017 (start of GST).' };
  if (value < '2000-01-01') return { ok: false, message: 'Invoice date is too far in the past.' };
  return { ok: true, message: '' };
};

// Optional. When given: a real date, on or after the invoice date, within 10 years of it.
export const validateDueDate = (dueDate, invoiceDate) => {
  if (!dueDate) return { ok: true, message: '' };
  if (!isRealIsoDate(dueDate)) return { ok: false, message: 'Enter a valid due date.' };
  if (isRealIsoDate(invoiceDate)) {
    if (dueDate < invoiceDate) return { ok: false, message: 'Due date cannot be before the invoice date.' };
    const limit = new Date(invoiceDate); limit.setFullYear(limit.getFullYear() + 10);
    if (new Date(dueDate) > limit) return { ok: false, message: 'Due date is more than 10 years after the invoice date.' };
  }
  return { ok: true, message: '' };
};
