-- Skema database Sistem Pengolahan Data Tugas Mahasiswa (PostgreSQL)
DROP TABLE IF EXISTS submissions, assignments, enrollments, courses, students, lecturers CASCADE;

CREATE TABLE lecturers (
  id    SERIAL PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE students (
  id         SERIAL PRIMARY KEY,
  nim        VARCHAR(20) NOT NULL UNIQUE,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE courses (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) NOT NULL UNIQUE,
  name        VARCHAR(150) NOT NULL,
  lecturer_id INTEGER NOT NULL REFERENCES lecturers(id) ON DELETE RESTRICT
);

-- Pivot many-to-many: students <-> courses
CREATE TABLE enrollments (
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, course_id)
);

CREATE TABLE assignments (
  id          SERIAL PRIMARY KEY,
  course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  deadline    TIMESTAMPTZ NOT NULL,
  max_score   INTEGER NOT NULL DEFAULT 100 CHECK (max_score BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE submissions (
  id            SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  content       TEXT NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_late       BOOLEAN NOT NULL DEFAULT FALSE,
  status        VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','graded')),
  score         INTEGER CHECK (score >= 0),
  feedback      TEXT,
  UNIQUE (assignment_id, student_id)
);

-- Data awal
INSERT INTO lecturers (name, email) VALUES
  ('Dr. Ratna Sari', 'ratna@kampus.ac.id'),
  ('Ir. Bambang Hadi', 'bambang@kampus.ac.id');

INSERT INTO students (nim, name, email) VALUES
  ('L0124001', 'Andi Pratama', 'andi@student.ac.id'),
  ('L0124002', 'Siti Rahma', 'siti@student.ac.id'),
  ('L0124003', 'Budi Santoso', 'budi@student.ac.id');

INSERT INTO courses (code, name, lecturer_id) VALUES
  ('IF101', 'Pemrograman Dasar', 1),
  ('IF102', 'Basis Data', 2);

INSERT INTO enrollments (student_id, course_id) VALUES (1,1),(2,1),(3,1),(1,2),(2,2);

INSERT INTO assignments (course_id, title, description, deadline, max_score) VALUES
  (1, 'Program Kasir C', 'Buat program kasir sederhana dengan bahasa C', NOW() + INTERVAL '7 days', 100),
  (2, 'Rancang ERD', 'Rancang ERD untuk sistem akademik', NOW() + INTERVAL '14 days', 100);

INSERT INTO submissions (assignment_id, student_id, content) VALUES
  (1, 1, 'https://github.com/andi/kasir-c');
