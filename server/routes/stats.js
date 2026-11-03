// Statistiques et progression (lecture seule)
import { Router } from 'express';
import { requireAuth } from '../middleware.js';
import { statistics, progression, periodDays } from '../services/stats.js';

const router = Router();
router.use(requireAuth);

function period(req, res) {
  const days = periodDays(req.query.period);
  if (days === undefined) { res.status(400).json({ error: 'Période invalide (7, 30, 90, 365 ou all).' }); return undefined; }
  return days;
}

router.get('/', (req, res) => {
  const days = period(req, res);
  if (days === undefined) return;
  res.json(statistics(req.user.id, days));
});

router.get('/progression', (req, res) => {
  const days = period(req, res);
  if (days === undefined) return;
  res.json(progression(req.user.id, days));
});

export default router;
