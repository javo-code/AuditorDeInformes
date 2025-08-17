const { diffMinutes, durationMinutes } = require('../utils/time');

// Key para matchear registros (simple y efectiva)
function makeKey(x) {
  return `${x.professionalId}|${x.serviceDate}|${x.serviceType}`;
}

function auditDiscrepancies({
  authorized,
  reported,
  startToleranceMin = 10,
  durationToleranceMin = 5
}) {
  const authMap = new Map();
  for (const a of authorized) {
    const key = makeKey(a);
    if (!authMap.has(key)) authMap.set(key, []);
    authMap.get(key).push(a);
  }

  const usedAuth = new Set();
  const discrepancies = [];

  // 1) Recorremos los reportes
  for (const r of reported) {
    const key = makeKey(r);
    const candidates = authMap.get(key) || [];

    if (candidates.length === 0) {
      discrepancies.push({
        type: 'NO_AUTH',
        professionalId: r.professionalId,
        serviceDate: r.serviceDate,
        serviceType: r.serviceType,
        details: 'Reporte sin autorización',
        reported: r
      });
      continue;
    }

    // Elegimos el autorizado más "cercano" en hora de inicio
    let best = null;
    let bestDelta = Infinity;
    for (const a of candidates) {
      const deltaStart = diffMinutes(a.startAt, r.startAt);
      if (deltaStart < bestDelta) {
        bestDelta = deltaStart;
        best = a;
      }
    }

    // Marcamos este autorizado como usado (para luego detectar faltantes)
    const usedId = `${key}#${authorized.indexOf(best)}`;
    usedAuth.add(usedId);

    // Reglas
    const deltaStart = diffMinutes(best.startAt, r.startAt);
    const authDur = best.authorizedMinutes ?? durationMinutes(best.startAt, best.endAt);
    const repDur = r.reportedMinutes ?? durationMinutes(r.startAt, r.endAt);
    const deltaDur = Math.abs(authDur - repDur);

    if (deltaStart > startToleranceMin) {
      discrepancies.push({
        type: 'START_MISMATCH',
        professionalId: r.professionalId,
        serviceDate: r.serviceDate,
        serviceType: r.serviceType,
        details: `Inicio fuera de tolerancia: ${deltaStart} min (tol ${startToleranceMin})`,
        authorized: best,
        reported: r
      });
    }

    if (deltaDur > durationToleranceMin) {
      discrepancies.push({
        type: 'DURATION_MISMATCH',
        professionalId: r.professionalId,
        serviceDate: r.serviceDate,
        serviceType: r.serviceType,
        details: `Duración difiere ${deltaDur} min (tol ${durationToleranceMin})`,
        authorized: best,
        reported: r
      });
    }
  }

  // 2) Autorizados sin reporte (faltantes)
  authorized.forEach((a, idx) => {
    const key = makeKey(a);
    const id = `${key}#${idx}`;
    if (!usedAuth.has(id)) {
      discrepancies.push({
        type: 'MISSING_REPORT',
        professionalId: a.professionalId,
        serviceDate: a.serviceDate,
        serviceType: a.serviceType,
        details: 'Autorizado sin reporte',
        authorized: a
      });
    }
  });

  // Resumen simple por tipo
  const summary = discrepancies.reduce((acc, d) => {
    acc[d.type] = (acc[d.type] || 0) + 1;
    return acc;
  }, {});

  return { discrepancies, summary };
}

module.exports = { auditDiscrepancies };
