-- Applied to the database selected by SQL_SANDBOX_DB (default: edu_sandbox).
-- Never touches the application schema.
DROP TABLE IF EXISTS enrollments; DROP TABLE IF EXISTS students; DROP TABLE IF EXISTS courses;
CREATE TABLE students (id INT PRIMARY KEY, name VARCHAR(60), cgpa DECIMAL(3,2), city VARCHAR(40));
CREATE TABLE courses (id INT PRIMARY KEY, title VARCHAR(80), credits INT);
CREATE TABLE enrollments (id INT PRIMARY KEY, student_id INT, course_id INT, marks INT);
INSERT INTO students VALUES (1,'Riya Verma',8.75,'Indore'),(2,'Aditya Nair',9.10,'Bhopal'),(3,'Sneha Patel',7.80,'Indore'),(4,'Rahul Kumar',6.90,'Jabalpur'),(5,'Ishita Bose',8.10,'Indore');
INSERT INTO courses VALUES (1,'Python Basics',4),(2,'DSA in C++',4),(3,'DBMS & SQL',3);
INSERT INTO enrollments VALUES (1,1,1,88),(2,1,2,76),(3,2,1,95),(4,2,2,91),(5,3,3,71),(6,4,1,58),(7,5,2,84);
