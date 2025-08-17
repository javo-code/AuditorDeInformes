let zonedTimeToUtcLib;
try {
  // En CJS debería funcionar así:
  ({ zonedTimeToUtc: zonedTimeToUtcLib } = require('date-fns-tz'));
} catch (_) {
  zonedTimeToUtcLib = undefined;
}

// Mapea TZ comunes a offset fijo (agregá si necesitás otros)
function tzToOffset(tz) {
  // Córdoba = UTC-3 todo el año (sin DST)
  if (!tz || tz.toLowerCase() === 'america/argentina/cordoba') return '-03:00';
  // fallback general: sin offset explícito (Z = UTC)
  return 'Z';
}

// Crea un Date en UTC desde "YYYY-MM-DD" + "HH:mm" en la TZ dada
function toZonedDate(isoDate, hhmm, tz = process.env.TZ || 'America/Argentina/Cordoba') {
  const [h = 0, m = 0] = String(hhmm || '').split(':').map(Number);
  const dateStr = `${isoDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

  if (typeof zonedTimeToUtcLib === 'function') {
    // Ruta "pro": usa date-fns-tz si está disponible
    return zonedTimeToUtcLib(dateStr, tz);
  }

  // Fallback robusto: construye el Date con offset fijo
  const offset = tzToOffset(tz);
  return new Date(`${dateStr}${offset}`);
}

// diferencia en minutos (valor absoluto)
function diffMinutes(a, b) {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 60000));
}

// duración en minutos (fin - inicio)
function durationMinutes(startAt, endAt) {
  return Math.round((endAt.getTime() - startAt.getTime()) / 60000);
}

module.exports = { toZonedDate, diffMinutes, durationMinutes };
