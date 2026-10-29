const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { runIngest } = require('../ingest/run');

function createAdminRouter(options = {}) {
  const router = express.Router();
  const onReload = options.onReload || (() => {});

  // Directorio para uploads temporales
  const uploadDir = path.join(config.dataDir, 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Configuración de Multer
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${sanitizedName}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB máximo
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.xlsx') {
        return cb(new Error('Solo se permiten archivos de Excel (.xlsx)'));
      }
      cb(null, true);
    }
  });

  // Middleware de autenticación básica mediante clave de administración
  function requireAdminKey(req, res, next) {
    const configuredKey = config.adminApiKey;
    if (!configuredKey) {
      return res.status(500).json({
        success: false,
        error: 'ADMIN_API_KEY no está configurada en las variables de entorno'
      });
    }

    const keyFromHeader = req.headers['x-admin-key'];
    const authHeader = req.headers['authorization'];
    const bearerKey = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const keyFromQuery = req.query.key;

    const providedKey = keyFromHeader || bearerKey || keyFromQuery;

    if (!providedKey || providedKey !== configuredKey) {
      return res.status(401).json({
        success: false,
        error: 'Clave de administración incorrecta o no proporcionada'
      });
    }

    next();
  }

  // 1. Verificar clave
  router.get('/verify', requireAdminKey, (req, res) => {
    res.json({
      success: true,
      message: 'Autenticación exitosa',
      serverTime: new Date().toISOString()
    });
  });

  // 2. Estado general y conteos
  router.get('/status', requireAdminKey, (req, res) => {
    try {
      const counts = { departamentos: 0, distritos: 0, ciudades: 0, barrios: 0 };
      let lastRun = null;

      const geoJsonPath = path.join(config.dataDir, 'geo.json');
      if (fs.existsSync(geoJsonPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
          counts.departamentos = (raw.deps || []).filter(d => d.is_active !== 0).length;
          counts.distritos = (raw.dists || []).filter(d => d.is_active !== 0).length;
          counts.ciudades = (raw.ciud || []).filter(c => c.is_active !== 0).length;
          counts.barrios = (raw.barrios || []).filter(b => b.is_active !== 0).length;
        } catch (e) {
          console.warn('[status] error leyendo geo.json:', e.message);
        }
      }

      const histPath = path.join(config.dataDir, 'ingest_history.json');
      if (fs.existsSync(histPath)) {
        try {
          const hist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
          lastRun = hist[0] || null;
        } catch (_) {}
      }

      res.json({
        success: true,
        counts,
        lastRun,
        dbPath: config.dbPath,
        geoJsonExists: fs.existsSync(geoJsonPath)
      });
    } catch (err) {
      console.error('[admin/status] error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Historial de ingestas
  router.get('/history', requireAdminKey, (req, res) => {
    try {
      const histPath = path.join(config.dataDir, 'ingest_history.json');
      let runs = [];
      if (fs.existsSync(histPath)) {
        try {
          runs = JSON.parse(fs.readFileSync(histPath, 'utf8'));
        } catch (_) {}
      }

      // Si no hay historial JSON pero hay SQLite, intentar leerlo opcionalmente
      if (runs.length === 0 && fs.existsSync(config.dbPath)) {
        try {
          const { getConnection } = require('../db/connection');
          const db = getConnection({ readonly: true });
          runs = db.prepare('SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 20').all();
          db.close();
        } catch (_) {}
      }

      res.json({ success: true, runs });
    } catch (err) {
      console.error('[admin/history] error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Subir y procesar archivo Excel
  router.post('/ingest', requireAdminKey, (req, res) => {
    try {
      upload.single('file')(req, res, async (err) => {
        if (err) {
          return res.status(400).json({
            success: false,
            error: err.message || 'Error al recibir el archivo'
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'No se envió ningún archivo Excel (.xlsx)'
          });
        }

        const uploadedFilePath = req.file.path;
        console.log(`[admin/ingest] Recibido archivo: ${req.file.originalname} (${req.file.size} bytes)`);

        try {
          const startTime = Date.now();
          const result = await runIngest(uploadedFilePath);
          const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

          // Notificar al servidor en memoria para que recargue geoData
          try {
            onReload();
          } catch (e) {
            console.warn('[admin/ingest] aviso al invocar onReload():', e.message);
          }

          // Eliminar el archivo temporal
          try {
            if (fs.existsSync(uploadedFilePath)) {
              fs.unlinkSync(uploadedFilePath);
            }
          } catch (unlinkErr) {
            console.warn('[admin/ingest] no se pudo borrar temp:', unlinkErr.message);
          }

          return res.json({
            success: true,
            message: 'Excel procesado e ingest completado con éxito',
            duration: `${durationSec}s`,
            filename: req.file.originalname,
            stats: {
              departamentos: result.dep.stats,
              distritos: result.dist.stats,
              ciudades: result.ciudad.stats,
              barrios: result.barrio.stats
            }
          });
        } catch (ingestErr) {
          console.error('[admin/ingest] error en runIngest:', ingestErr);
          try {
            if (fs.existsSync(uploadedFilePath)) {
              fs.unlinkSync(uploadedFilePath);
            }
          } catch (_) {}

          return res.status(500).json({
            success: false,
            error: `Error durante la ingesta: ${ingestErr.message}`
          });
        }
      });
    } catch (outerErr) {
      console.error('[admin/ingest] error fatal externo:', outerErr);
      return res.status(500).json({
        success: false,
        error: `Error interno al procesar upload: ${outerErr.message}`
      });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
