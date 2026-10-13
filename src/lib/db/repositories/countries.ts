/**
 * Country repository — thin CRUD over the `countries` table.
 *
 * All functions are ISO-based where possible to match the rest of the
 * codebase (which stores `iso` rather than numeric PKs). Where we need a
 * numeric id (for FK writes elsewhere), we expose both.
 */

import { prisma } from '../client';

export async function listCountries() {
  return prisma.country.findMany({
    orderBy: { name: 'asc' },
  });
}

export async function getCountryByIso(iso: string) {
  // Accept iso2 (e.g. "US") or iso3 ("USA"). We normalise upper-case.
  const code = iso.toUpperCase();
  return prisma.country.findFirst({
    where: {
      OR: [{ iso2: code }, { iso3: code }],
    },
  });
}

export async function upsertCountry(input: {
  iso2: string;
  iso3: string;
  name: string;
  region?: string | null;
  population?: number | null;
  gdpMillionsUsd?: number | null;
  governmentType?: string | null;
  headOfState?: string | null;
  flagEmoji?: string | null;
}) {
  return prisma.country.upsert({
    where: { iso2: input.iso2 },
    create: {
      iso2: input.iso2,
      iso3: input.iso3,
      name: input.name,
      region: input.region ?? null,
      population: input.population != null ? BigInt(input.population) : null,
      gdpMillionsUsd:
        input.gdpMillionsUsd != null ? BigInt(input.gdpMillionsUsd) : null,
      governmentType: input.governmentType ?? null,
      headOfState: input.headOfState ?? null,
      flagEmoji: input.flagEmoji ?? null,
    },
    update: {
      iso3: input.iso3,
      name: input.name,
      region: input.region ?? null,
      population: input.population != null ? BigInt(input.population) : null,
      gdpMillionsUsd:
        input.gdpMillionsUsd != null ? BigInt(input.gdpMillionsUsd) : null,
      governmentType: input.governmentType ?? null,
      headOfState: input.headOfState ?? null,
      flagEmoji: input.flagEmoji ?? null,
    },
  });
}
