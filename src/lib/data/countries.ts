export interface Country {
  iso: string;
  name: string;
  region: string;
  subregion: string;
  population: number;
  gdp: number;
  governmentType: string;
  headOfState: string;
  capital: string;
  lat: number;
  lon: number;
  flagEmoji: string;
  incomeGroup: string;
}

export const countries: Country[] = [
  {
    iso: "US", name: "United States", region: "Americas", subregion: "North America",
    population: 334914895, gdp: 27360000, governmentType: "Federal presidential republic",
    headOfState: "Donald Trump", capital: "Washington, D.C.", lat: 38.9, lon: -77.04,
    flagEmoji: "🇺🇸", incomeGroup: "High income"
  },
  {
    iso: "CN", name: "China", region: "Asia", subregion: "East Asia",
    population: 1425671352, gdp: 17790000, governmentType: "One-party socialist republic",
    headOfState: "Xi Jinping", capital: "Beijing", lat: 39.9, lon: 116.4,
    flagEmoji: "🇨🇳", incomeGroup: "Upper middle income"
  },
  {
    iso: "DE", name: "Germany", region: "Europe", subregion: "Western Europe",
    population: 84482267, gdp: 4460000, governmentType: "Federal parliamentary republic",
    headOfState: "Friedrich Merz", capital: "Berlin", lat: 52.52, lon: 13.405,
    flagEmoji: "🇩🇪", incomeGroup: "High income"
  },
  {
    iso: "GB", name: "United Kingdom", region: "Europe", subregion: "Northern Europe",
    population: 67791000, gdp: 3340000, governmentType: "Constitutional monarchy",
    headOfState: "Keir Starmer", capital: "London", lat: 51.51, lon: -0.13,
    flagEmoji: "🇬🇧", incomeGroup: "High income"
  },
  {
    iso: "FR", name: "France", region: "Europe", subregion: "Western Europe",
    population: 68170228, gdp: 3050000, governmentType: "Semi-presidential republic",
    headOfState: "Emmanuel Macron", capital: "Paris", lat: 48.86, lon: 2.35,
    flagEmoji: "🇫🇷", incomeGroup: "High income"
  },
  {
    iso: "JP", name: "Japan", region: "Asia", subregion: "East Asia",
    population: 123294513, gdp: 4230000, governmentType: "Constitutional monarchy",
    headOfState: "Shigeru Ishiba", capital: "Tokyo", lat: 35.68, lon: 139.69,
    flagEmoji: "🇯🇵", incomeGroup: "High income"
  },
  {
    iso: "IN", name: "India", region: "Asia", subregion: "South Asia",
    population: 1428627663, gdp: 3730000, governmentType: "Federal parliamentary republic",
    headOfState: "Narendra Modi", capital: "New Delhi", lat: 28.61, lon: 77.21,
    flagEmoji: "🇮🇳", incomeGroup: "Lower middle income"
  },
  {
    iso: "BR", name: "Brazil", region: "Americas", subregion: "South America",
    population: 216422446, gdp: 2170000, governmentType: "Federal presidential republic",
    headOfState: "Luiz Inácio Lula da Silva", capital: "Brasília", lat: -15.79, lon: -47.88,
    flagEmoji: "🇧🇷", incomeGroup: "Upper middle income"
  },
  {
    iso: "AU", name: "Australia", region: "Oceania", subregion: "Oceania",
    population: 26638544, gdp: 1720000, governmentType: "Federal parliamentary monarchy",
    headOfState: "Anthony Albanese", capital: "Canberra", lat: -35.28, lon: 149.13,
    flagEmoji: "🇦🇺", incomeGroup: "High income"
  },
  {
    iso: "CA", name: "Canada", region: "Americas", subregion: "North America",
    population: 40528396, gdp: 2140000, governmentType: "Federal parliamentary monarchy",
    headOfState: "Justin Trudeau (Prime Minister)", capital: "Ottawa", lat: 45.42, lon: -75.7,
    flagEmoji: "🇨🇦", incomeGroup: "High income"
  },
  {
    iso: "KR", name: "South Korea", region: "Asia", subregion: "East Asia",
    population: 51712619, gdp: 1710000, governmentType: "Presidential republic",
    headOfState: "Han Duck-soo", capital: "Seoul", lat: 37.57, lon: 126.98,
    flagEmoji: "🇰🇷", incomeGroup: "High income"
  },
  {
    iso: "SA", name: "Saudi Arabia", region: "Asia", subregion: "Western Asia",
    population: 36947025, gdp: 1060000, governmentType: "Absolute monarchy",
    headOfState: "Mohammed bin Salman", capital: "Riyadh", lat: 24.71, lon: 46.67,
    flagEmoji: "🇸🇦", incomeGroup: "High income"
  },
  {
    iso: "NG", name: "Nigeria", region: "Africa", subregion: "West Africa",
    population: 223804632, gdp: 472000, governmentType: "Federal presidential republic",
    headOfState: "Bola Tinubu", capital: "Abuja", lat: 9.06, lon: 7.49,
    flagEmoji: "🇳🇬", incomeGroup: "Lower middle income"
  },
  {
    iso: "SE", name: "Sweden", region: "Europe", subregion: "Northern Europe",
    population: 10551707, gdp: 599000, governmentType: "Constitutional monarchy",
    headOfState: "Ulf Kristersson", capital: "Stockholm", lat: 59.33, lon: 18.07,
    flagEmoji: "🇸🇪", incomeGroup: "High income"
  },
  {
    iso: "SG", name: "Singapore", region: "Asia", subregion: "Southeast Asia",
    population: 5917648, gdp: 497000, governmentType: "Parliamentary republic",
    headOfState: "Lawrence Wong", capital: "Singapore", lat: 1.35, lon: 103.82,
    flagEmoji: "🇸🇬", incomeGroup: "High income"
  },
];

export function getCountry(iso: string): Country | undefined {
  return countries.find(c => c.iso === iso.toUpperCase());
}

export function getCountriesByRegion(region: string): Country[] {
  return countries.filter(c => c.region === region);
}
