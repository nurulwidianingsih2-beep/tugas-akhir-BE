const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());

// ---------- Helper ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isPosInt = (v) => /^\d+$/.test(String(v)) && Number(v) > 0;
const isBlank = (v) => typeof v !== 'string' || v.trim() === '';
const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const bad = (m) => new HttpError(400, m);
const nf = (m) => new HttpError(404, m);

['id', 'student_id'].forEach((name) =>
  app.param(name, (req, res, next, val) => {
    if (!isPosInt(val)) return res.status(400).json({ error: `${name} harus berupa angka positif` });
    next();
  })
);

// Bangun UPDATE parsial dari field yang dikirim
async function patchRow(table, id, body, allowed, notFoundMsg) {
  const fields = allowed.filter((f) => body[f] !== undefined);
  if (!fields.length) throw bad(`Kirim minimal satu field: ${allowed.join(', ')}`);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values = fields.map((f) => (typeof body[f] === 'string' ? body[f].trim() : body[f]));
  const { rows } = await pool.query(`UPDATE ${table} SET ${sets} WHERE id = $${fields.length + 1} RETURNING *`, [...values, id]);
  if (!rows.length) throw nf(notFoundMsg);
  return rows[0];
}

// ---------- Root ----------
app.get('/', (req, res) => {
  res.json({
    message: 'REST API Sistem Pengolahan Data Tugas Mahasiswa',
    resources: ['/lecturers', '/students', '/courses', '/assignments', '/submissions'],
  });
});

// ======================================================
// LECTURERS (dosen)
// ======================================================
app.get('/lecturers', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM lecturers ORDER BY id');
  res.json({ data: rows });
}));

app.get('/lecturers/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM lecturers WHERE id = $1', [req.params.id]);
  if (!rows.length) throw nf('Dosen tidak ditemukan');
  res.json({ data: rows[0] });
}));

app.post('/lecturers', wrap(async (req, res) => {
  const { name, email } = req.body || {};
  if (isBlank(name)) throw bad('Field name wajib diisi');
  if (!isEmail(email)) throw bad('Field email tidak valid');
  const { rows } = await pool.query('INSERT INTO lecturers (name, email) VALUES ($1,$2) RETURNING *', [name.trim(), email.trim()]);
  res.status(201).json({ message: 'Dosen berhasil ditambahkan', data: rows[0] });
}));

app.patch('/lecturers/:id', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.name !== undefined && isBlank(b.name)) throw bad('Field name tidak boleh kosong');
  if (b.email !== undefined && !isEmail(b.email)) throw bad('Field email tidak valid');
  const row = await patchRow('lecturers', req.params.id, b, ['name', 'email'], 'Dosen tidak ditemukan');
  res.json({ message: 'Dosen berhasil diperbarui', data: row });
}));

app.delete('/lecturers/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM lecturers WHERE id = $1', [req.params.id]);
  if (!rowCount) throw nf('Dosen tidak ditemukan');
  res.json({ message: 'Dosen berhasil dihapus' });
}));

// ======================================================
// STUDENTS (mahasiswa) + laporan pengolahan data
// ======================================================
app.get('/students', wrap(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.q) { params.push(`%${req.query.q}%`); where = 'WHERE name ILIKE $1 OR nim ILIKE $1'; }
  const { rows } = await pool.query(`SELECT * FROM students ${where} ORDER BY id`, params);
  res.json({ data: rows });
}));

app.get('/students/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id]);
  if (!rows.length) throw nf('Mahasiswa tidak ditemukan');
  res.json({ data: rows[0] });
}));

app.post('/students', wrap(async (req, res) => {
  const { nim, name, email } = req.body || {};
  if (isBlank(nim)) throw bad('Field nim wajib diisi');
  if (isBlank(name)) throw bad('Field name wajib diisi');
  if (!isEmail(email)) throw bad('Field email tidak valid');
  const { rows } = await pool.query('INSERT INTO students (nim, name, email) VALUES ($1,$2,$3) RETURNING *', [nim.trim(), name.trim(), email.trim()]);
  res.status(201).json({ message: 'Mahasiswa berhasil ditambahkan', data: rows[0] });
}));

app.patch('/students/:id', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.nim !== undefined && isBlank(b.nim)) throw bad('Field nim tidak boleh kosong');
  if (b.name !== undefined && isBlank(b.name)) throw bad('Field name tidak boleh kosong');
  if (b.email !== undefined && !isEmail(b.email)) throw bad('Field email tidak valid');
  const row = await patchRow('students', req.params.id, b, ['nim', 'name', 'email'], 'Mahasiswa tidak ditemukan');
  res.json({ message: 'Mahasiswa berhasil diperbarui', data: row });
}));

app.delete('/students/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
  if (!rowCount) throw nf('Mahasiswa tidak ditemukan');
  res.json({ message: 'Mahasiswa berhasil dihapus' });
}));

// Laporan progres tugas satu mahasiswa
app.get('/students/:id/report', wrap(async (req, res) => {
  const st = await pool.query('SELECT id, nim, name FROM students WHERE id = $1', [req.params.id]);
  if (!st.rows.length) throw nf('Mahasiswa tidak ditemukan');
  const { rows } = await pool.query(
    `SELECT a.id AS assignment_id, a.title, c.code AS course_code, a.deadline, a.max_score,
            s.id AS submission_id, s.status, s.is_late, s.score
     FROM enrollments e
     JOIN assignments a ON a.course_id = e.course_id
     JOIN courses c ON c.id = a.course_id
     LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.student_id
     WHERE e.student_id = $1 ORDER BY a.deadline`,
    [req.params.id]
  );
  const submitted = rows.filter((r) => r.submission_id);
  const graded = rows.filter((r) => r.status === 'graded');
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null);
  res.json({
    data: {
      student: st.rows[0],
      summary: {
        total_assignments: rows.length,
        submitted: submitted.length,
        not_submitted: rows.length - submitted.length,
        late: submitted.filter((r) => r.is_late).length,
        graded: graded.length,
        average_score: avg(graded.map((r) => r.score)),
        average_percentage: avg(graded.map((r) => (r.score / r.max_score) * 100)),
      },
      assignments: rows,
    },
  });
}));

// ======================================================
// COURSES (mata kuliah) + enrollment (many-to-many)
// ======================================================
const COURSE_SELECT = `
  SELECT c.id, c.code, c.name, c.lecturer_id, l.name AS lecturer,
         (SELECT COUNT(*)::int FROM enrollments e WHERE e.course_id = c.id) AS student_count
  FROM courses c JOIN lecturers l ON l.id = c.lecturer_id`;

function validateCourse(b) {
  if (isBlank(b.code)) throw bad('Field code wajib diisi');
  if (isBlank(b.name)) throw bad('Field name wajib diisi');
  if (!isPosInt(b.lecturer_id)) throw bad('Field lecturer_id wajib berupa angka');
}

app.get('/courses', wrap(async (req, res) => {
  const { rows } = await pool.query(`${COURSE_SELECT} ORDER BY c.id`);
  res.json({ data: rows });
}));

app.get('/courses/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(`${COURSE_SELECT} WHERE c.id = $1`, [req.params.id]);
  if (!rows.length) throw nf('Mata kuliah tidak ditemukan');
  res.json({ data: rows[0] });
}));

app.post('/courses', wrap(async (req, res) => {
  const b = req.body || {};
  validateCourse(b);
  const { rows } = await pool.query('INSERT INTO courses (code, name, lecturer_id) VALUES ($1,$2,$3) RETURNING *', [b.code.trim(), b.name.trim(), b.lecturer_id]);
  res.status(201).json({ message: 'Mata kuliah berhasil ditambahkan', data: rows[0] });
}));

app.put('/courses/:id', wrap(async (req, res) => {
  const b = req.body || {};
  validateCourse(b);
  const { rows } = await pool.query('UPDATE courses SET code=$1, name=$2, lecturer_id=$3 WHERE id=$4 RETURNING *', [b.code.trim(), b.name.trim(), b.lecturer_id, req.params.id]);
  if (!rows.length) throw nf('Mata kuliah tidak ditemukan');
  res.json({ message: 'Mata kuliah berhasil diperbarui', data: rows[0] });
}));

app.delete('/courses/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM courses WHERE id = $1', [req.params.id]);
  if (!rowCount) throw nf('Mata kuliah tidak ditemukan');
  res.json({ message: 'Mata kuliah berhasil dihapus' });
}));

app.get('/courses/:id/students', wrap(async (req, res) => {
  const c = await pool.query('SELECT 1 FROM courses WHERE id = $1', [req.params.id]);
  if (!c.rowCount) throw nf('Mata kuliah tidak ditemukan');
  const { rows } = await pool.query(
    `SELECT s.id, s.nim, s.name, s.email, e.enrolled_at
     FROM enrollments e JOIN students s ON s.id = e.student_id
     WHERE e.course_id = $1 ORDER BY s.nim`, [req.params.id]);
  res.json({ data: rows });
}));

app.post('/courses/:id/students', wrap(async (req, res) => {
  const { student_id } = req.body || {};
  if (!isPosInt(student_id)) throw bad('Field student_id wajib berupa angka');
  const c = await pool.query('SELECT 1 FROM courses WHERE id = $1', [req.params.id]);
  if (!c.rowCount) throw nf('Mata kuliah tidak ditemukan');
  const s = await pool.query('SELECT 1 FROM students WHERE id = $1', [student_id]);
  if (!s.rowCount) throw nf('Mahasiswa tidak ditemukan');
  const { rows } = await pool.query('INSERT INTO enrollments (student_id, course_id) VALUES ($1,$2) RETURNING *', [student_id, req.params.id]);
  res.status(201).json({ message: 'Mahasiswa berhasil didaftarkan ke mata kuliah', data: rows[0] });
}));

app.delete('/courses/:id/students/:student_id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM enrollments WHERE course_id = $1 AND student_id = $2', [req.params.id, req.params.student_id]);
  if (!rowCount) throw nf('Mahasiswa tidak terdaftar pada mata kuliah ini');
  res.json({ message: 'Mahasiswa berhasil dikeluarkan dari mata kuliah' });
}));

// ======================================================
// ASSIGNMENTS (tugas) - resource utama, CRUD lengkap + PUT & PATCH
// ======================================================
const ASSIGNMENT_SELECT = `
  SELECT a.*, c.code AS course_code, c.name AS course_name
  FROM assignments a JOIN courses c ON c.id = a.course_id`;

function validateAssignment(b, partial) {
  const need = (f) => !partial || b[f] !== undefined;
  if (need('course_id') && !isPosInt(b.course_id)) throw bad('Field course_id wajib berupa angka');
  if (need('title') && isBlank(b.title)) throw bad('Field title wajib diisi');
  if (need('deadline') && !isDate(b.deadline)) throw bad('Field deadline wajib berformat tanggal valid (contoh 2026-11-30T23:59:00+07:00)');
  if (b.max_score !== undefined && !(Number.isInteger(b.max_score) && b.max_score >= 1 && b.max_score <= 1000)) throw bad('Field max_score harus bilangan bulat 1-1000');
  if (b.description !== undefined && b.description !== null && typeof b.description !== 'string') throw bad('Field description harus berupa teks');
}

app.get('/assignments', wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.course_id) {
    if (!isPosInt(req.query.course_id)) throw bad('course_id harus berupa angka');
    params.push(req.query.course_id); where.push(`a.course_id = $${params.length}`);
  }
  if (req.query.upcoming === 'true') where.push('a.deadline > NOW()');
  const { rows } = await pool.query(`${ASSIGNMENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.deadline`, params);
  res.json({ data: rows });
}));

app.get('/assignments/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [req.params.id]);
  if (!rows.length) throw nf('Tugas tidak ditemukan');
  res.json({ data: rows[0] });
}));

app.post('/assignments', wrap(async (req, res) => {
  const b = req.body || {};
  validateAssignment(b, false);
  const { rows } = await pool.query(
    'INSERT INTO assignments (course_id, title, description, deadline, max_score) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.course_id, b.title.trim(), b.description ?? null, b.deadline, b.max_score ?? 100]
  );
  res.status(201).json({ message: 'Tugas berhasil ditambahkan', data: rows[0] });
}));

app.put('/assignments/:id', wrap(async (req, res) => {
  const b = req.body || {};
  validateAssignment(b, false);
  const { rows } = await pool.query(
    'UPDATE assignments SET course_id=$1, title=$2, description=$3, deadline=$4, max_score=$5 WHERE id=$6 RETURNING *',
    [b.course_id, b.title.trim(), b.description ?? null, b.deadline, b.max_score ?? 100, req.params.id]
  );
  if (!rows.length) throw nf('Tugas tidak ditemukan');
  res.json({ message: 'Tugas berhasil diperbarui', data: rows[0] });
}));

app.patch('/assignments/:id', wrap(async (req, res) => {
  const b = req.body || {};
  validateAssignment(b, true);
  const row = await patchRow('assignments', req.params.id, b, ['course_id', 'title', 'description', 'deadline', 'max_score'], 'Tugas tidak ditemukan');
  res.json({ message: 'Tugas berhasil diperbarui', data: row });
}));

app.delete('/assignments/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
  if (!rowCount) throw nf('Tugas tidak ditemukan');
  res.json({ message: 'Tugas berhasil dihapus' });
}));

// Rekap pengolahan data satu tugas
app.get('/assignments/:id/summary', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.deadline, a.max_score,
            (SELECT COUNT(*)::int FROM enrollments e WHERE e.course_id = a.course_id) AS total_students,
            COUNT(s.id)::int AS total_submissions,
            (COUNT(*) FILTER (WHERE s.is_late))::int AS late_submissions,
            COUNT(s.score)::int AS graded,
            ROUND(AVG(s.score), 2)::float8 AS average_score,
            MAX(s.score) AS highest_score,
            MIN(s.score) AS lowest_score
     FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id
     WHERE a.id = $1 GROUP BY a.id`, [req.params.id]);
  if (!rows.length) throw nf('Tugas tidak ditemukan');
  const missing = await pool.query(
    `SELECT st.id, st.nim, st.name
     FROM assignments a
     JOIN enrollments e ON e.course_id = a.course_id
     JOIN students st ON st.id = e.student_id
     WHERE a.id = $1
       AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assignment_id = a.id AND s.student_id = st.id)
     ORDER BY st.nim`, [req.params.id]);
  const d = rows[0];
  d.not_submitted = missing.rows.length;
  d.not_submitted_students = missing.rows;
  res.json({ data: d });
}));

// ======================================================
// SUBMISSIONS (pengumpulan tugas)
// ======================================================
const SUBMISSION_SELECT = `
  SELECT s.id, s.assignment_id, a.title AS assignment_title, a.max_score,
         s.student_id, st.nim, st.name AS student_name,
         s.content, s.submitted_at, s.is_late, s.status, s.score, s.feedback
  FROM submissions s
  JOIN assignments a ON a.id = s.assignment_id
  JOIN students st ON st.id = s.student_id`;

app.get('/submissions', wrap(async (req, res) => {
  const where = [];
  const params = [];
  for (const f of ['assignment_id', 'student_id']) {
    if (req.query[f]) {
      if (!isPosInt(req.query[f])) throw bad(`${f} harus berupa angka`);
      params.push(req.query[f]); where.push(`s.${f} = $${params.length}`);
    }
  }
  if (req.query.status) {
    if (!['submitted', 'graded'].includes(req.query.status)) throw bad("status harus 'submitted' atau 'graded'");
    params.push(req.query.status); where.push(`s.status = $${params.length}`);
  }
  const { rows } = await pool.query(`${SUBMISSION_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.id`, params);
  res.json({ data: rows });
}));

app.get('/submissions/:id', wrap(async (req, res) => {
  const { rows } = await pool.query(`${SUBMISSION_SELECT} WHERE s.id = $1`, [req.params.id]);
  if (!rows.length) throw nf('Pengumpulan tidak ditemukan');
  res.json({ data: rows[0] });
}));

app.post('/submissions', wrap(async (req, res) => {
  const { assignment_id, student_id, content } = req.body || {};
  if (!isPosInt(assignment_id)) throw bad('Field assignment_id wajib berupa angka');
  if (!isPosInt(student_id)) throw bad('Field student_id wajib berupa angka');
  if (isBlank(content)) throw bad('Field content wajib diisi (jawaban atau link tugas)');

  const a = await pool.query('SELECT course_id, deadline FROM assignments WHERE id = $1', [assignment_id]);
  if (!a.rows.length) throw nf('Tugas tidak ditemukan');
  const s = await pool.query('SELECT 1 FROM students WHERE id = $1', [student_id]);
  if (!s.rowCount) throw nf('Mahasiswa tidak ditemukan');
  const e = await pool.query('SELECT 1 FROM enrollments WHERE student_id = $1 AND course_id = $2', [student_id, a.rows[0].course_id]);
  if (!e.rowCount) throw bad('Mahasiswa tidak terdaftar pada mata kuliah tugas ini');

  const ins = await pool.query(
    'INSERT INTO submissions (assignment_id, student_id, content, is_late) VALUES ($1,$2,$3,NOW() > $4) RETURNING id',
    [assignment_id, student_id, content.trim(), a.rows[0].deadline]
  );
  const { rows } = await pool.query(`${SUBMISSION_SELECT} WHERE s.id = $1`, [ins.rows[0].id]);
  res.status(201).json({ message: 'Tugas berhasil dikumpulkan', data: rows[0] });
}));

// Revisi pengumpulan (hanya sebelum dinilai)
app.put('/submissions/:id', wrap(async (req, res) => {
  const { content } = req.body || {};
  if (isBlank(content)) throw bad('Field content wajib diisi');
  const cur = await pool.query(
    'SELECT s.status, a.deadline FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.id = $1', [req.params.id]);
  if (!cur.rows.length) throw nf('Pengumpulan tidak ditemukan');
  if (cur.rows[0].status === 'graded') throw bad('Tugas sudah dinilai, tidak bisa diubah');
  await pool.query(
    'UPDATE submissions SET content = $1, submitted_at = NOW(), is_late = (NOW() > $2) WHERE id = $3',
    [content.trim(), cur.rows[0].deadline, req.params.id]
  );
  const { rows } = await pool.query(`${SUBMISSION_SELECT} WHERE s.id = $1`, [req.params.id]);
  res.json({ message: 'Pengumpulan berhasil diperbarui', data: rows[0] });
}));

// Penilaian oleh dosen
app.patch('/submissions/:id/grade', wrap(async (req, res) => {
  const { score, feedback } = req.body || {};
  const cur = await pool.query(
    'SELECT a.max_score FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.id = $1', [req.params.id]);
  if (!cur.rows.length) throw nf('Pengumpulan tidak ditemukan');
  const max = cur.rows[0].max_score;
  if (!Number.isInteger(score) || score < 0 || score > max) throw bad(`Field score harus bilangan bulat 0-${max}`);
  if (feedback !== undefined && feedback !== null && typeof feedback !== 'string') throw bad('Field feedback harus berupa teks');
  await pool.query("UPDATE submissions SET score = $1, feedback = $2, status = 'graded' WHERE id = $3", [score, feedback ?? null, req.params.id]);
  const { rows } = await pool.query(`${SUBMISSION_SELECT} WHERE s.id = $1`, [req.params.id]);
  res.json({ message: 'Nilai berhasil disimpan', data: rows[0] });
}));

app.delete('/submissions/:id', wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM submissions WHERE id = $1', [req.params.id]);
  if (!rowCount) throw nf('Pengumpulan tidak ditemukan');
  res.json({ message: 'Pengumpulan berhasil dihapus' });
}));

// ---------- 404 & Error handler ----------
app.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body JSON tidak valid' });
  if (err.code === '23505') return res.status(409).json({ error: 'Data duplikat (sudah ada data dengan nilai yang sama)' });
  if (err.code === '23503') return res.status(409).json({ error: 'Operasi ditolak: data referensi tidak ditemukan atau masih dipakai data lain' });
  if (err.code === '23514') return res.status(400).json({ error: 'Data melanggar aturan validasi database' });
  if (err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'Format tanggal tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

module.exports = app;
