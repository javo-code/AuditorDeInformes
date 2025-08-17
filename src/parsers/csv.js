// src/parsers/csv.js
const { parse } = require('csv-parse/sync');
const { z } = require('zod');
const { toZonedDate } = require('../utils/time');

const TZ = process.env.TZ || 'America/Argentina/Cordoba';

/* -----------------------------------------------------------
   Prelimpieza: quita comillas que envuelven la línea completa
   (caso: "a,b,c" -> a,b,c)
----------------------------------------------------------- */
function stripWholeLineQuotes(csvText) {
  return String(csvText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => {
      const s = line.trim();
      if (s.startsWith('"') && s.endsWith('"')) {
        return s.slice(1, -1);
      }
      return line;
    })
    .join('\n');
}

/* -----------------------------------------------------------
   Normalización de encabezados y filas
----------------------------------------------------------- */
function normalizeKey(k) {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[._-]/g, '');
}

function normalizeRow(row) {
  const map = {};
  for (const k of Object.keys(row)) {
    map[normalizeKey(k)] = typeof row[k] === 'string' ? row[k].trim() : row[k];
  }
  return map;
}

/* -----------------------------------------------------------
   Alias de encabezados (soporta ES/EN y variaciones)
----------------------------------------------------------- */
const HEADER_ALIASES = {
  professionalId: [
    'professionalid', 'idprofesional', 'idprofessional',
    'profesionalid', 'legajo', 'empleadoid'
  ],
  serviceDate: [
    'servicedate', 'fecha', 'fechaservicio', 'fechaatencion'
  ],
  start: [
    'start', 'inicio', 'horainicio', 'desde'
  ],
  end: [
    'end', 'fin', 'horafin', 'hasta'
  ],
  authorizedMinutes: [
    'authorizedminutes', 'minutosautorizados', 'duracionautorizada',
    'duracionminutos', 'minutos'
  ],
  reportedMinutes: [
    'reportedminutes', 'minutosreportados', 'duracionreportada'
  ],
  serviceType: [
    'servicetype', 'tipo', 'tiposervicio', 'prestacion'
  ]
};

function pick(map, keys) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(map, k) && map[k] !== '') {
      return map[k];
    }
  }
  return undefined;
}

/* -----------------------------------------------------------
   Conversión laxa a número (soporta coma/punto y miles)
----------------------------------------------------------- */
function toNumberLoosely(v) {
  if (v === undefined || v === null || v === '') return undefined;
  // quita puntos de miles y usa punto como decimal
  const s = String(v).replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/* -----------------------------------------------------------
   Fechas y horas
----------------------------------------------------------- */
function hhmmToDate(isoDate, hhmm, tz) {
  // permite HH:mm o HH:mm:ss
  const parts = String(hhmm || '').split(':').map(n => Number(n));
  const h = parts[0] || 0;
  const m = parts[1] || 0;
  // usamos util que interpreta esa hora en TZ y convierte a UTC
  const hhmmNorm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return toZonedDate(isoDate, hhmmNorm, tz);
}

/* -----------------------------------------------------------
   Detección simple de separador por primera línea
----------------------------------------------------------- */
function detectDelimiter(csvText) {
  const firstLine = String(csvText || '')
    .split('\n')
    .find(l => l.trim().length > 0) || '';
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length
  };
  let best = ',';
  let max = -1;
  for (const [d, c] of Object.entries(counts)) {
    if (c > max) { max = c; best = d; }
  }
  return best;
}

/* -----------------------------------------------------------
   Esquemas Zod
----------------------------------------------------------- */
const baseSchema = {
  professionalId: z.string().min(1, 'professionalId requerido'),
  serviceDate:    z.string().min(1, 'serviceDate requerido'), // YYYY-MM-DD
  start:          z.string().min(1, 'start requerido'),       // HH:mm
  end:            z.string().min(1, 'end requerido'),         // HH:mm
  serviceType:    z.string().min(1).default('general')
};

const authorizedSchema = z.object({
  ...baseSchema,
  authorizedMinutes: z.number().int().nonnegative()
});

const reportedSchema = z.object({
  ...baseSchema,
  reportedMinutes: z.number().int().nonnegative()
});

/* -----------------------------------------------------------
   Parseadores
----------------------------------------------------------- */
function parseAuthorizedCSV(csvText) {
  // 1) Prelimpieza por comillas envolventes
  const cleaned = stripWholeLineQuotes(csvText);

  // 2) Detección de separador
  const delimiter = detectDelimiter(cleaned);

  // 3) Parseo robusto
  const records = parse(cleaned, {
    bom: true,
    columns: true,
    delimiter,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  // 4) Normalización + alias + validación
  return records.map((r, idx) => {
    const m = normalizeRow(r);

    const professionalId  = pick(m, HEADER_ALIASES.professionalId);
    const serviceDate     = pick(m, HEADER_ALIASES.serviceDate);
    const start           = pick(m, HEADER_ALIASES.start);
    const end             = pick(m, HEADER_ALIASES.end);
    const serviceType     = pick(m, HEADER_ALIASES.serviceType) || 'general';

    // minutos autorizados: si falta, lo calculamos (end - start)
    let authorizedMinutes = toNumberLoosely(pick(m, HEADER_ALIASES.authorizedMinutes));
    if (authorizedMinutes === undefined && start && end && serviceDate) {
      const startAtTmp = hhmmToDate(serviceDate, start, TZ);
      const endAtTmp   = hhmmToDate(serviceDate, end, TZ);
      authorizedMinutes = Math.round((endAtTmp.getTime() - startAtTmp.getTime()) / 60000);
    }

    const parsed = authorizedSchema.parse({
      professionalId,
      serviceDate,
      start,
      end,
      authorizedMinutes,
      serviceType
    });

    const startAt = hhmmToDate(parsed.serviceDate, parsed.start, TZ);
    const endAt   = hhmmToDate(parsed.serviceDate, parsed.end, TZ);

    return { ...parsed, startAt, endAt, source: 'authorized', _row: idx + 1 };
  });
}

function parseReportedCSV(csvText) {
  // 1) Prelimpieza por comillas envolventes
  const cleaned = stripWholeLineQuotes(csvText);

  // 2) Detección de separador
  const delimiter = detectDelimiter(cleaned);

  // 3) Parseo robusto
  const records = parse(cleaned, {
    bom: true,
    columns: true,
    delimiter,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  // 4) Normalización + alias + validación
  return records.map((r, idx) => {
    const m = normalizeRow(r);

    const professionalId  = pick(m, HEADER_ALIASES.professionalId);
    const serviceDate     = pick(m, HEADER_ALIASES.serviceDate);
    const start           = pick(m, HEADER_ALIASES.start);
    const end             = pick(m, HEADER_ALIASES.end);
    const serviceType     = pick(m, HEADER_ALIASES.serviceType) || 'general';

    let reportedMinutes = toNumberLoosely(pick(m, HEADER_ALIASES.reportedMinutes));
    if (reportedMinutes === undefined && start && end && serviceDate) {
      const startAtTmp = hhmmToDate(serviceDate, start, TZ);
      const endAtTmp   = hhmmToDate(serviceDate, end, TZ);
      reportedMinutes = Math.round((endAtTmp.getTime() - startAtTmp.getTime()) / 60000);
    }

    const parsed = reportedSchema.parse({
      professionalId,
      serviceDate,
      start,
      end,
      reportedMinutes,
      serviceType
    });

    const startAt = hhmmToDate(parsed.serviceDate, parsed.start, TZ);
    const endAt   = hhmmToDate(parsed.serviceDate, parsed.end, TZ);

    return { ...parsed, startAt, endAt, source: 'reported', _row: idx + 1 };
  });
}

module.exports = { parseAuthorizedCSV, parseReportedCSV };
