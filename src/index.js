require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const morgan = require('morgan');
const multer = require('multer');
const engine = require('ejs-mate');

const { parseAuthorizedCSV, parseReportedCSV } = require('./parsers/csv');
const { auditDiscrepancies } = require('./audit/rules');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== View engine (EJS + ejs-mate) ==========
app.engine('ejs', engine); // 👈 habilita layout('layout')
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views')); // .../auditor-node/views

// ========== Middlewares ==========
app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use(morgan('dev'));

// Multer en memoria para subir CSV
const upload = multer({ storage: multer.memoryStorage() });

// ======== Logs de diagnóstico al arrancar ========
console.log('Views folder:', app.get('views'));
try {
  const viewsDir = app.get('views');
  console.log('Exists index.ejs:', fs.existsSync(path.join(viewsDir, 'index.ejs')));
  console.log('Exists results.ejs:', fs.existsSync(path.join(viewsDir, 'results.ejs')));
  console.log('Exists layout.ejs:', fs.existsSync(path.join(viewsDir, 'layout.ejs')));
  console.log('Dir listing:', fs.readdirSync(viewsDir));
} catch (e) {
  console.error('Error inspeccionando carpeta de vistas:', e);
}

// ========= Rutas =========

// Ruta de depuración para ver qué ve el server
app.get('/debug-views', (req, res) => {
  const dir = app.get('views');
  let listing = [];
  try {
    listing = fs.readdirSync(dir);
  } catch (e) {
    return res
      .status(500)
      .type('text')
      .send(`Error leyendo ${dir}\n\n${e?.stack || e}`);
  }
  res
    .status(200)
    .type('text')
    .send(
      [
        `views dir: ${dir}`,
        `index.ejs exists: ${fs.existsSync(path.join(dir, 'index.ejs'))}`,
        `results.ejs exists: ${fs.existsSync(path.join(dir, 'results.ejs'))}`,
        `layout.ejs exists: ${fs.existsSync(path.join(dir, 'layout.ejs'))}`,
        '',
        'files:',
        ...listing
      ].join('\n')
    );
});

// Página principal
app.get('/', (req, res) => {
  // Si algo fallara al resolver la vista, el log anterior te lo va a cantar.
  res.render('index', {
    title: 'Auditor de Informes',
    defaults: { startToleranceMin: 10, durationToleranceMin: 5 }
  });
});

// Procesar subida y auditar
app.post(
  '/audit',
  upload.fields([
    { name: 'authorized', maxCount: 1 },
    { name: 'reported', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const stTol = Number(req.body.startToleranceMin ?? 10);
      const durTol = Number(req.body.durationToleranceMin ?? 5);

      if (!req.files?.authorized?.[0] || !req.files?.reported?.[0]) {
        return res.status(400).send('Faltan archivos CSV');
      }

      const authorized = parseAuthorizedCSV(
        req.files.authorized[0].buffer.toString('utf-8')
      );
      const reported = parseReportedCSV(
        req.files.reported[0].buffer.toString('utf-8')
      );

      const result = auditDiscrepancies({
        authorized,
        reported,
        startToleranceMin: stTol,
        durationToleranceMin: durTol
      });

      res.render('results', {
        title: 'Resultados de Auditoría',
        tolerances: { stTol, durTol },
        summary: result.summary,
        discrepancies: result.discrepancies
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error procesando auditoría: ' + err.message);
    }
  }
);

// Arranque del server
app.listen(PORT, () => {
  console.log(`Auditor corriendo en http://localhost:${PORT}`);
});