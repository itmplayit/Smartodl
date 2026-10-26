'use strict';
/** Coding-arena schema additions owned by the API migration registry. */
const { exec } = require('../config/db');

async function ensureSchema() {
  // Persist each judged case when it happens. Rebuilding a historical
  // submission from the *current* test-case table misreports pass/fail as
  // soon as an author edits, reorders or deletes a test.
  await exec(
    `CREATE TABLE IF NOT EXISTS coding_submission_results (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
       submission_id BIGINT UNSIGNED NOT NULL,
       test_case_id INT UNSIGNED DEFAULT NULL,
       is_hidden TINYINT(1) NOT NULL DEFAULT 0,
       passed TINYINT(1) NOT NULL DEFAULT 0,
       status VARCHAR(40) NOT NULL DEFAULT 'internal_error',
       execution_time DECIMAL(10,3) NOT NULL DEFAULT 0,
       position INT UNSIGNED NOT NULL DEFAULT 1,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       UNIQUE KEY uq_submission_result_position (submission_id, position),
       KEY idx_submission_results_submission (submission_id, is_hidden, position),
       CONSTRAINT fk_submission_results_submission
         FOREIGN KEY (submission_id) REFERENCES coding_submissions(id) ON DELETE CASCADE,
       CONSTRAINT fk_submission_results_test_case
         FOREIGN KEY (test_case_id) REFERENCES coding_test_cases(id) ON DELETE SET NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

module.exports = { ensureSchema };
