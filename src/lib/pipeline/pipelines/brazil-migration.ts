/**
 * Brazil migration pipeline — Ministério da Justiça e Segurança Pública, Migrações.
 *
 * Source: https://www.gov.br/mj/pt-br/assuntos/seus-direitos/migracoes
 */
import { buildIndexPipeline } from '../helpers/factory';

export const brazilMigrationPipeline = buildIndexPipeline({
  key: 'brazil-migration',
  label: 'Brazil MJSP — Migrações',
  canonicalSlug: 'mjsp-migracoes',
  defaultTitle: 'Brazil MJSP — Migrações index',
  defaultSummary:
    'Ministério da Justiça e Segurança Pública migrations section covering Brazilian migration policy and operational guidance.',
  acceptHeader:
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
});
