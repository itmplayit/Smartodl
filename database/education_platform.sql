/*M!999999\- enable the sandbox mode */
-- MariaDB dump 10.19-11.8.6-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: 127.0.0.1    Database: education_platform
-- ------------------------------------------------------
-- Server version	11.8.6-MariaDB-0+deb13u1 from Debian

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Current Database: `education_platform`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `itm` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */;

USE `itm`;

--
-- Table structure for table `achievements`
--

DROP TABLE IF EXISTS `achievements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `achievements` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(60) NOT NULL,
  `title` varchar(120) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `icon` varchar(20) DEFAULT '?',
  `badge_color` varchar(20) DEFAULT '#6366f1',
  `criteria_type` enum('quiz_count','quiz_score','problems_solved','course_completed','contest_participation','points','custom') NOT NULL DEFAULT 'custom',
  `criteria_value` int(11) NOT NULL DEFAULT 0,
  `points_reward` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_achievement_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `app_meta`
--

DROP TABLE IF EXISTS `app_meta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_meta` (
  `meta_key` varchar(64) NOT NULL,
  `meta_value` varchar(255) NOT NULL DEFAULT '',
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`meta_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `type` enum('course','note','quiz','problem','contest','all') NOT NULL DEFAULT 'all',
  `description` varchar(255) DEFAULT NULL,
  `icon` varchar(60) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_category_type_slug` (`type`,`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `certificate_templates`
--

DROP TABLE IF EXISTS `certificate_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `certificate_templates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(60) NOT NULL,
  `name` varchar(120) NOT NULL,
  `cert_type` enum('course','quiz','contest','milestone','path') NOT NULL DEFAULT 'course',
  `headline` varchar(120) NOT NULL DEFAULT 'Certificate of Completion',
  `subtitle` varchar(255) NOT NULL DEFAULT '',
  `recipient_line` varchar(60) NOT NULL DEFAULT 'Awarded to',
  `seal_text` varchar(40) NOT NULL DEFAULT 'VERIFIED',
  `label` varchar(60) NOT NULL DEFAULT '',
  `logo_path` varchar(255) DEFAULT NULL,
  `color_bg_from` varchar(9) NOT NULL DEFAULT '#0f172a',
  `color_bg_to` varchar(9) NOT NULL DEFAULT '#0b1020',
  `color_accent` varchar(9) NOT NULL DEFAULT '#fbbf24',
  `color_accent_2` varchar(9) NOT NULL DEFAULT '#fde68a',
  `color_accent_3` varchar(9) NOT NULL DEFAULT '#f59e0b',
  `color_seal_from` varchar(9) NOT NULL DEFAULT '#fbbf24',
  `color_seal_to` varchar(9) NOT NULL DEFAULT '#b45309',
  `color_seal_border` varchar(9) NOT NULL DEFAULT '#fde68a',
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `is_builtin` tinyint(1) NOT NULL DEFAULT 0,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_ct_type` (`cert_type`,`is_default`,`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `certificates`
--

DROP TABLE IF EXISTS `certificates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `certificates` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `course_id` int(10) unsigned DEFAULT NULL,
  `context_id` int(10) unsigned DEFAULT NULL,
  `enrollment_id` int(10) unsigned DEFAULT NULL,
  `template_id` int(11) DEFAULT NULL,
  `design_snapshot` longtext DEFAULT NULL,
  `cert_type` enum('course','quiz','contest','milestone','path') NOT NULL DEFAULT 'course',
  `certificate_no` varchar(32) NOT NULL,
  `public_token` varchar(40) NOT NULL,
  `grade` varchar(6) DEFAULT 'A',
  `tier` varchar(20) DEFAULT 'completion',
  `score_percent` decimal(5,2) DEFAULT 100.00,
  `issued_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `title` varchar(200) DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `revoked_by` int(10) unsigned DEFAULT NULL,
  `revoke_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cert_no` (`certificate_no`),
  UNIQUE KEY `uniq_token` (`public_token`),
  KEY `idx_user` (`user_id`),
  KEY `idx_course` (`course_id`),
  KEY `idx_context` (`context_id`),
  KEY `idx_enrollment` (`enrollment_id`),
  KEY `idx_type` (`cert_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `coding_languages`
--

DROP TABLE IF EXISTS `coding_languages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `coding_languages` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(60) NOT NULL,
  `slug` varchar(40) NOT NULL,
  `judge0_id` int(11) DEFAULT NULL,
  `editor_mode` varchar(40) NOT NULL,
  `runner` varchar(30) DEFAULT NULL,
  `version` varchar(40) DEFAULT NULL,
  `template_code` text DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_language_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `coding_problems`
--

DROP TABLE IF EXISTS `coding_problems`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `coding_problems` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `slug` varchar(220) NOT NULL,
  `description` longtext NOT NULL,
  `difficulty` enum('easy','medium','hard') NOT NULL DEFAULT 'easy',
  `category_id` int(10) unsigned DEFAULT NULL,
  `points` int(10) unsigned NOT NULL DEFAULT 10,
  `constraints` text DEFAULT NULL,
  `input_format` text DEFAULT NULL,
  `output_format` text DEFAULT NULL,
  `explanation` text DEFAULT NULL,
  `starter_code` longtext DEFAULT NULL,
  `tags` longtext DEFAULT NULL,
  `time_limit_ms` int(10) unsigned NOT NULL DEFAULT 2000,
  `memory_limit_kb` int(10) unsigned NOT NULL DEFAULT 262144,
  `time_limit_minutes` int(11) DEFAULT NULL,
  `total_submissions` int(10) unsigned NOT NULL DEFAULT 0,
  `accepted_submissions` int(10) unsigned NOT NULL DEFAULT 0,
  `acceptance_rate` decimal(5,2) NOT NULL DEFAULT 0.00,
  `created_by` int(10) unsigned DEFAULT NULL,
  `is_premium` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('draft','published','unpublished') NOT NULL DEFAULT 'published',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `hints` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_problem_slug` (`slug`),
  KEY `idx_problem_diff` (`difficulty`),
  KEY `idx_problem_cat` (`category_id`),
  KEY `idx_problem_status` (`status`),
  KEY `fk_problem_creator` (`created_by`),
  CONSTRAINT `fk_problem_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_problem_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `coding_submission_results`
--

DROP TABLE IF EXISTS `coding_submission_results`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `coding_submission_results` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `submission_id` bigint(20) unsigned NOT NULL,
  `test_case_id` int(10) unsigned DEFAULT NULL,
  `is_hidden` tinyint(1) NOT NULL DEFAULT 0,
  `passed` tinyint(1) NOT NULL DEFAULT 0,
  `status` varchar(40) NOT NULL DEFAULT 'internal_error',
  `execution_time` decimal(10,3) NOT NULL DEFAULT 0.000,
  `position` int(10) unsigned NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_submission_result_position` (`submission_id`,`position`),
  KEY `idx_submission_results_submission` (`submission_id`,`is_hidden`,`position`),
  KEY `fk_submission_results_test_case` (`test_case_id`),
  CONSTRAINT `fk_submission_results_submission` FOREIGN KEY (`submission_id`) REFERENCES `coding_submissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_submission_results_test_case` FOREIGN KEY (`test_case_id`) REFERENCES `coding_test_cases` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `coding_submissions`
--

DROP TABLE IF EXISTS `coding_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `coding_submissions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `problem_id` int(10) unsigned NOT NULL,
  `contest_id` int(10) unsigned DEFAULT NULL,
  `language` varchar(40) NOT NULL,
  `source_code` longtext NOT NULL,
  `status` enum('queued','running','accepted','wrong_answer','compilation_error','runtime_error','time_limit_exceeded','memory_limit_exceeded','internal_error') NOT NULL DEFAULT 'queued',
  `test_cases_passed` int(10) unsigned NOT NULL DEFAULT 0,
  `total_test_cases` int(10) unsigned NOT NULL DEFAULT 0,
  `execution_time` decimal(8,3) NOT NULL DEFAULT 0.000,
  `memory_used` int(10) unsigned NOT NULL DEFAULT 0,
  `score` int(11) NOT NULL DEFAULT 0,
  `judge_token` varchar(100) DEFAULT NULL,
  `stdout` text DEFAULT NULL,
  `compile_output` text DEFAULT NULL,
  `stderr` text DEFAULT NULL,
  `ai_score` int(11) DEFAULT NULL,
  `ai_signals` varchar(255) DEFAULT NULL,
  `paste_events` int(11) NOT NULL DEFAULT 0,
  `pasted_chars` int(11) NOT NULL DEFAULT 0,
  `typed_chars` int(11) NOT NULL DEFAULT 0,
  `paste_ratio` decimal(4,3) NOT NULL DEFAULT 0.000,
  `submitted_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `evaluated_at` datetime DEFAULT NULL,
  `ai_style_score` tinyint(3) unsigned DEFAULT NULL,
  `ai_paste_score` tinyint(3) unsigned DEFAULT NULL,
  `ai_timing_score` tinyint(3) unsigned DEFAULT NULL,
  `ai_verdict` varchar(12) DEFAULT NULL,
  `ai_trusted` tinyint(1) NOT NULL DEFAULT 0,
  `blocked_pastes` int(10) unsigned NOT NULL DEFAULT 0,
  `keystrokes` int(10) unsigned NOT NULL DEFAULT 0,
  `typing_ms` int(10) unsigned NOT NULL DEFAULT 0,
  `fast_intervals` int(10) unsigned NOT NULL DEFAULT 0,
  `uniform_ratio` decimal(4,3) NOT NULL DEFAULT 0.000,
  PRIMARY KEY (`id`),
  KEY `idx_sub_user` (`user_id`),
  KEY `idx_sub_problem` (`problem_id`),
  KEY `idx_sub_status` (`status`),
  KEY `idx_sub_time` (`submitted_at`),
  CONSTRAINT `fk_sub_problem` FOREIGN KEY (`problem_id`) REFERENCES `coding_problems` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sub_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `coding_test_cases`
--

DROP TABLE IF EXISTS `coding_test_cases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `coding_test_cases` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `problem_id` int(10) unsigned NOT NULL,
  `input` text DEFAULT NULL,
  `expected_output` text NOT NULL,
  `is_hidden` tinyint(1) NOT NULL DEFAULT 0,
  `points` int(10) unsigned NOT NULL DEFAULT 5,
  `position` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_tc_problem` (`problem_id`),
  KEY `idx_tc_hidden` (`is_hidden`),
  CONSTRAINT `fk_tc_problem` FOREIGN KEY (`problem_id`) REFERENCES `coding_problems` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `contest_participants`
--

DROP TABLE IF EXISTS `contest_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contest_participants` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `contest_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `score` int(11) NOT NULL DEFAULT 0,
  `solved_count` int(10) unsigned NOT NULL DEFAULT 0,
  `penalty_minutes` int(10) unsigned NOT NULL DEFAULT 0,
  `rank_position` int(10) unsigned DEFAULT NULL,
  `last_submission_at` datetime DEFAULT NULL,
  `registered_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contest_participant` (`contest_id`,`user_id`),
  KEY `idx_cpart_user` (`user_id`),
  CONSTRAINT `fk_cpart_contest` FOREIGN KEY (`contest_id`) REFERENCES `contests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cpart_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `contest_problems`
--

DROP TABLE IF EXISTS `contest_problems`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contest_problems` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `contest_id` int(10) unsigned NOT NULL,
  `problem_id` int(10) unsigned NOT NULL,
  `label` varchar(10) DEFAULT NULL,
  `points_override` int(10) unsigned DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 1,
  `solved_count` int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contest_problem` (`contest_id`,`problem_id`),
  KEY `idx_cp_problem` (`problem_id`),
  CONSTRAINT `fk_cp_contest` FOREIGN KEY (`contest_id`) REFERENCES `contests` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cp_problem` FOREIGN KEY (`problem_id`) REFERENCES `coding_problems` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `contests`
--

DROP TABLE IF EXISTS `contests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contests` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `slug` varchar(220) NOT NULL,
  `description` text DEFAULT NULL,
  `contest_type` enum('coding','quiz') NOT NULL DEFAULT 'coding',
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `duration_minutes` int(10) unsigned NOT NULL DEFAULT 120,
  `max_participants` int(10) unsigned DEFAULT NULL,
  `registered_count` int(10) unsigned NOT NULL DEFAULT 0,
  `is_rated` tinyint(1) NOT NULL DEFAULT 1,
  `rules` text DEFAULT NULL,
  `status` enum('draft','scheduled','published','live','completed','cancelled') NOT NULL DEFAULT 'draft',
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `editorial` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contest_slug` (`slug`),
  KEY `idx_contest_status` (`status`),
  KEY `fk_contest_creator` (`created_by`),
  CONSTRAINT `fk_contest_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `course_modules`
--

DROP TABLE IF EXISTS `course_modules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_modules` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `course_id` int(10) unsigned NOT NULL,
  `title` varchar(180) NOT NULL,
  `description` varchar(400) DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_module_course` (`course_id`),
  CONSTRAINT `fk_module_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `course_reviews`
--

DROP TABLE IF EXISTS `course_reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `course_reviews` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `course_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `rating` tinyint(3) unsigned NOT NULL,
  `comment` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_review_once` (`course_id`,`user_id`),
  KEY `fk_review_user` (`user_id`),
  CONSTRAINT `fk_review_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_review_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `courses`
--

DROP TABLE IF EXISTS `courses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `courses` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(180) NOT NULL,
  `slug` varchar(200) NOT NULL,
  `summary` varchar(300) DEFAULT NULL,
  `description` longtext DEFAULT NULL,
  `thumbnail` varchar(255) DEFAULT NULL,
  `category_id` int(10) unsigned DEFAULT NULL,
  `difficulty` enum('beginner','intermediate','advanced') NOT NULL DEFAULT 'beginner',
  `language` varchar(60) DEFAULT NULL,
  `duration_hours` decimal(5,1) NOT NULL DEFAULT 0.0,
  `lessons_count` int(10) unsigned NOT NULL DEFAULT 0,
  `instructor_id` int(10) unsigned DEFAULT NULL,
  `price` decimal(8,2) NOT NULL DEFAULT 0.00,
  `rating` decimal(3,2) NOT NULL DEFAULT 4.50,
  `total_students` int(10) unsigned NOT NULL DEFAULT 0,
  `is_featured` tinyint(1) NOT NULL DEFAULT 0,
  `is_premium` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('draft','published','unpublished') NOT NULL DEFAULT 'draft',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `completion_policy` varchar(20) NOT NULL DEFAULT 'click',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_courses_slug` (`slug`),
  KEY `idx_courses_status` (`status`),
  KEY `idx_courses_category` (`category_id`),
  KEY `idx_courses_instructor` (`instructor_id`),
  CONSTRAINT `fk_courses_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_courses_instructor` FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `discussion_replies`
--

DROP TABLE IF EXISTS `discussion_replies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `discussion_replies` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `discussion_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_reply_disc` (`discussion_id`),
  KEY `fk_reply_user` (`user_id`),
  CONSTRAINT `fk_reply_disc` FOREIGN KEY (`discussion_id`) REFERENCES `discussions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reply_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `discussions`
--

DROP TABLE IF EXISTS `discussions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `discussions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `parent_type` varchar(20) NOT NULL,
  `parent_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `title` varchar(200) NOT NULL,
  `body` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_disc_parent` (`parent_type`,`parent_id`),
  KEY `fk_disc_user` (`user_id`),
  CONSTRAINT `fk_disc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `enrollments`
--

DROP TABLE IF EXISTS `enrollments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `enrollments` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `course_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `progress_percent` decimal(5,2) NOT NULL DEFAULT 0.00,
  `completed_lessons` int(10) unsigned NOT NULL DEFAULT 0,
  `status` enum('active','completed','dropped') NOT NULL DEFAULT 'active',
  `last_accessed_at` datetime DEFAULT NULL,
  `enrolled_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_enrollment` (`course_id`,`user_id`),
  KEY `idx_enroll_user` (`user_id`),
  CONSTRAINT `fk_enroll_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_enroll_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `landing_media`
--

DROP TABLE IF EXISTS `landing_media`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `landing_media` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `file_name` varchar(255) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `url` varchar(500) NOT NULL,
  `mime_type` varchar(100) NOT NULL,
  `file_size` int(10) unsigned NOT NULL,
  `alt_text` varchar(255) DEFAULT '',
  `uploaded_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_landing_media_url` (`url`),
  KEY `idx_landing_media_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `landing_page_builder`
--

DROP TABLE IF EXISTS `landing_page_builder`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `landing_page_builder` (
  `id` tinyint(3) unsigned NOT NULL DEFAULT 1,
  `draft_json` longtext NOT NULL,
  `published_json` longtext NOT NULL,
  `draft_version` int(10) unsigned NOT NULL DEFAULT 1,
  `published_version` int(10) unsigned NOT NULL DEFAULT 1,
  `updated_by` int(10) unsigned DEFAULT NULL,
  `published_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `published_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `landing_page_revisions`
--

DROP TABLE IF EXISTS `landing_page_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `landing_page_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `version` int(10) unsigned NOT NULL,
  `document_json` longtext NOT NULL,
  `published_by` int(10) unsigned DEFAULT NULL,
  `published_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_landing_revision_version` (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `leaderboard`
--

DROP TABLE IF EXISTS `leaderboard`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `leaderboard` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `scope` enum('global','weekly','monthly','contest','course') NOT NULL DEFAULT 'global',
  `scope_ref` int(10) unsigned DEFAULT NULL,
  `scope_ref_key` int(10) unsigned GENERATED ALWAYS AS (coalesce(`scope_ref`,0)) VIRTUAL,
  `problems_solved` int(10) unsigned NOT NULL DEFAULT 0,
  `points` int(11) NOT NULL DEFAULT 0,
  `submissions` int(10) unsigned NOT NULL DEFAULT 0,
  `accuracy` decimal(5,2) NOT NULL DEFAULT 0.00,
  `rank_position` int(10) unsigned DEFAULT NULL,
  `period_start` date DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_leaderboard` (`scope`,`scope_ref_key`,`user_id`),
  UNIQUE KEY `uq_lb_scope_ref_key` (`scope`,`scope_ref_key`,`user_id`),
  KEY `idx_lb_scope` (`scope`,`scope_ref`,`points`),
  KEY `fk_lb_user` (`user_id`),
  CONSTRAINT `fk_lb_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lesson_opens`
--

DROP TABLE IF EXISTS `lesson_opens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lesson_opens` (
  `user_id` int(10) unsigned NOT NULL,
  `lesson_id` int(10) unsigned NOT NULL,
  `opened_at` datetime NOT NULL,
  PRIMARY KEY (`user_id`,`lesson_id`),
  KEY `idx_lo_lesson` (`lesson_id`),
  CONSTRAINT `fk_lo_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lo_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lesson_progress`
--

DROP TABLE IF EXISTS `lesson_progress`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lesson_progress` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `course_id` int(10) unsigned NOT NULL,
  `lesson_id` int(10) unsigned NOT NULL,
  `completed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_lesson_progress` (`user_id`,`lesson_id`),
  KEY `idx_lp_course` (`course_id`),
  KEY `fk_lp_lesson` (`lesson_id`),
  CONSTRAINT `fk_lp_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lesson_watch`
--

DROP TABLE IF EXISTS `lesson_watch`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lesson_watch` (
  `user_id` int(10) unsigned NOT NULL,
  `lesson_id` int(10) unsigned NOT NULL,
  `duration_seconds` decimal(10,2) NOT NULL DEFAULT 0.00,
  `last_position` decimal(10,2) NOT NULL DEFAULT 0.00,
  `last_rate` decimal(4,2) NOT NULL DEFAULT 1.00,
  `last_beat_at` datetime(3) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`,`lesson_id`),
  KEY `idx_lw_lesson` (`lesson_id`),
  CONSTRAINT `fk_lw_lesson` FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lw_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lesson_watch_buckets`
--

DROP TABLE IF EXISTS `lesson_watch_buckets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lesson_watch_buckets` (
  `user_id` int(10) unsigned NOT NULL,
  `lesson_id` int(10) unsigned NOT NULL,
  `bucket_index` int(10) unsigned NOT NULL,
  PRIMARY KEY (`user_id`,`lesson_id`,`bucket_index`),
  KEY `idx_lwb_lesson` (`lesson_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `lessons`
--

DROP TABLE IF EXISTS `lessons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lessons` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `module_id` int(10) unsigned NOT NULL,
  `course_id` int(10) unsigned NOT NULL,
  `title` varchar(180) NOT NULL,
  `description` varchar(400) DEFAULT NULL,
  `video_url` varchar(255) DEFAULT NULL,
  `content` longtext DEFAULT NULL,
  `resource_url` varchar(255) DEFAULT NULL,
  `video_path` varchar(255) DEFAULT NULL,
  `video_name` varchar(180) DEFAULT NULL,
  `pdf_path` varchar(255) DEFAULT NULL,
  `pdf_name` varchar(180) DEFAULT NULL,
  `duration_minutes` int(10) unsigned NOT NULL DEFAULT 10,
  `position` int(11) NOT NULL DEFAULT 1,
  `is_preview` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_lesson_module` (`module_id`),
  KEY `idx_lesson_course` (`course_id`),
  CONSTRAINT `fk_lesson_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lesson_module` FOREIGN KEY (`module_id`) REFERENCES `course_modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notes`
--

DROP TABLE IF EXISTS `notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `slug` varchar(220) NOT NULL,
  `description` varchar(400) DEFAULT NULL,
  `subject` varchar(120) DEFAULT NULL,
  `course_id` int(10) unsigned DEFAULT NULL,
  `category_id` int(10) unsigned DEFAULT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `file_type` enum('pdf','doc','docx','ppt','pptx','image','zip','txt','md') NOT NULL DEFAULT 'pdf',
  `file_size` int(10) unsigned NOT NULL DEFAULT 0,
  `pages` int(10) unsigned DEFAULT NULL,
  `download_count` int(10) unsigned NOT NULL DEFAULT 0,
  `view_count` int(10) unsigned NOT NULL DEFAULT 0,
  `uploaded_by` int(10) unsigned DEFAULT NULL,
  `status` enum('draft','published','unpublished') NOT NULL DEFAULT 'published',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notes_slug` (`slug`),
  KEY `idx_notes_course` (`course_id`),
  KEY `idx_notes_status` (`status`),
  KEY `fk_notes_category` (`category_id`),
  KEY `fk_notes_user` (`uploaded_by`),
  CONSTRAINT `fk_notes_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_notes_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_notes_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notification_reads`
--

DROP TABLE IF EXISTS `notification_reads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_reads` (
  `notification_id` bigint(20) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `read_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`notification_id`,`user_id`),
  KEY `idx_notification_reads_user` (`user_id`,`read_at`),
  CONSTRAINT `fk_notification_reads_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_reads_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned DEFAULT NULL,
  `audience` enum('all','student','developer','admin','user') NOT NULL DEFAULT 'all',
  `title` varchar(180) NOT NULL,
  `message` text NOT NULL,
  `type` enum('course','note','quiz','contest','coding','achievement','system') NOT NULL DEFAULT 'system',
  `link` varchar(255) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notif_user` (`user_id`),
  KEY `idx_notif_audience` (`audience`),
  KEY `fk_notif_creator` (`created_by`),
  CONSTRAINT `fk_notif_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `permissions`
--

DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `permissions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(60) NOT NULL,
  `label` varchar(120) NOT NULL,
  `group_name` varchar(60) NOT NULL DEFAULT 'general',
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permissions_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `plans`
--

DROP TABLE IF EXISTS `plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `plans` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(80) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `features` text DEFAULT NULL,
  `price_paise` int(10) unsigned NOT NULL DEFAULT 0,
  `duration_days` int(10) unsigned NOT NULL DEFAULT 30,
  `highlight` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plans_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `point_adjustments`
--

DROP TABLE IF EXISTS `point_adjustments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `point_adjustments` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `delta` int(11) NOT NULL,
  `reason` varchar(255) NOT NULL DEFAULT '',
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_pa_user` (`user_id`),
  KEY `idx_pa_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `proctor_events`
--

DROP TABLE IF EXISTS `proctor_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `proctor_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `attempt_id` bigint(20) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `detail` varchar(255) DEFAULT NULL,
  `occurred_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_proctor_attempt` (`attempt_id`,`occurred_at`),
  CONSTRAINT `fk_proctor_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `quiz_attempts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `proctor_recording_files`
--

DROP TABLE IF EXISTS `proctor_recording_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `proctor_recording_files` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `session_id` char(36) NOT NULL,
  `feed` enum('camera','screen') NOT NULL,
  `storage_path` varchar(255) NOT NULL,
  `mime_type` varchar(80) NOT NULL DEFAULT 'video/webm',
  `byte_size` bigint(20) unsigned NOT NULL DEFAULT 0,
  `next_chunk` int(10) unsigned NOT NULL DEFAULT 0,
  `duration_ms` int(10) unsigned NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proctor_recording_feed` (`session_id`,`feed`),
  CONSTRAINT `fk_proctor_recording_file_session` FOREIGN KEY (`session_id`) REFERENCES `proctor_recording_sessions` (`session_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `proctor_recording_sessions`
--

DROP TABLE IF EXISTS `proctor_recording_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `proctor_recording_sessions` (
  `session_id` char(36) NOT NULL,
  `attempt_id` bigint(20) unsigned NOT NULL,
  `quiz_id` bigint(20) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `requested_by` int(10) unsigned NOT NULL,
  `status` enum('requested','recording','stopping','completed','declined','cancelled','interrupted','failed') NOT NULL DEFAULT 'requested',
  `total_bytes` bigint(20) unsigned NOT NULL DEFAULT 0,
  `requested_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `consented_at` timestamp NULL DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `ended_at` timestamp NULL DEFAULT NULL,
  `last_activity_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`session_id`),
  KEY `idx_proctor_recording_attempt` (`attempt_id`,`requested_at`),
  KEY `idx_proctor_recording_cleanup` (`status`,`ended_at`,`last_activity_at`),
  CONSTRAINT `fk_proctor_recording_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `quiz_attempts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `quiz_answers`
--

DROP TABLE IF EXISTS `quiz_answers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quiz_answers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `attempt_id` bigint(20) unsigned NOT NULL,
  `question_id` int(10) unsigned NOT NULL,
  `selected_answer` longtext DEFAULT NULL,
  `language` varchar(24) DEFAULT NULL,
  `tests_passed` int(10) unsigned DEFAULT NULL,
  `tests_total` int(10) unsigned DEFAULT NULL,
  `verification_hash` char(64) DEFAULT NULL,
  `verified` tinyint(1) NOT NULL DEFAULT 0,
  `is_correct` tinyint(1) NOT NULL DEFAULT 0,
  `marks_awarded` decimal(6,2) NOT NULL DEFAULT 0.00,
  `time_spent_seconds` int(10) unsigned NOT NULL DEFAULT 0,
  `answered_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_answer` (`attempt_id`,`question_id`),
  KEY `idx_ans_question` (`question_id`),
  CONSTRAINT `fk_ans_attempt` FOREIGN KEY (`attempt_id`) REFERENCES `quiz_attempts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ans_question` FOREIGN KEY (`question_id`) REFERENCES `quiz_questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `quiz_attempts`
--

DROP TABLE IF EXISTS `quiz_attempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quiz_attempts` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `quiz_id` int(10) unsigned NOT NULL,
  `user_id` int(10) unsigned NOT NULL,
  `status` enum('in_progress','submitted','evaluated','abandoned') NOT NULL DEFAULT 'in_progress',
  `score` decimal(8,2) NOT NULL DEFAULT 0.00,
  `total_marks` int(10) unsigned NOT NULL DEFAULT 0,
  `correct_count` int(10) unsigned NOT NULL DEFAULT 0,
  `wrong_count` int(10) unsigned NOT NULL DEFAULT 0,
  `unattempted_count` int(10) unsigned NOT NULL DEFAULT 0,
  `accuracy` decimal(5,2) NOT NULL DEFAULT 0.00,
  `time_taken_seconds` int(10) unsigned NOT NULL DEFAULT 0,
  `rank_position` int(10) unsigned DEFAULT NULL,
  `passed` tinyint(1) NOT NULL DEFAULT 0,
  `ip_address` varchar(60) DEFAULT NULL,
  `started_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `submitted_at` datetime DEFAULT NULL,
  `tab_violations` int(10) unsigned NOT NULL DEFAULT 0,
  `last_seen_at` datetime DEFAULT NULL,
  `left_flag` tinyint(1) NOT NULL DEFAULT 0,
  `screenshot_events` int(10) unsigned NOT NULL DEFAULT 0,
  `copy_events` int(10) unsigned NOT NULL DEFAULT 0,
  `paste_events` int(10) unsigned NOT NULL DEFAULT 0,
  `suspect_questions` int(10) unsigned NOT NULL DEFAULT 0,
  `paste_questions` int(10) unsigned NOT NULL DEFAULT 0,
  `suspect_list` varchar(255) DEFAULT NULL,
  `paste_list` varchar(255) DEFAULT NULL,
  `ai_score` int(11) DEFAULT NULL,
  `ai_signals` varchar(255) DEFAULT NULL,
  `paste_pct` int(11) DEFAULT NULL,
  `ai_style_score` tinyint(3) unsigned DEFAULT NULL,
  `ai_paste_score` tinyint(3) unsigned DEFAULT NULL,
  `ai_timing_score` tinyint(3) unsigned DEFAULT NULL,
  `ai_verdict` varchar(12) DEFAULT NULL,
  `ai_trusted` tinyint(1) NOT NULL DEFAULT 0,
  `typed_chars` int(10) unsigned NOT NULL DEFAULT 0,
  `pasted_chars` int(10) unsigned NOT NULL DEFAULT 0,
  `blocked_pastes` int(10) unsigned NOT NULL DEFAULT 0,
  `keystrokes` int(10) unsigned NOT NULL DEFAULT 0,
  `typing_ms` int(10) unsigned NOT NULL DEFAULT 0,
  `fast_intervals` int(10) unsigned NOT NULL DEFAULT 0,
  `uniform_ratio` decimal(4,3) NOT NULL DEFAULT 0.000,
  `proctor_camera` tinyint(1) NOT NULL DEFAULT 0,
  `proctor_screen` tinyint(1) NOT NULL DEFAULT 0,
  `proctor_violations` int(10) unsigned NOT NULL DEFAULT 0,
  `proctor_flags` varchar(255) DEFAULT NULL,
  `proctor_policy` text DEFAULT NULL,
  `active_slot` int(10) unsigned GENERATED ALWAYS AS (case when `status` = 'in_progress' then `user_id` else NULL end) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attempt_active` (`quiz_id`,`active_slot`),
  KEY `idx_qa_quiz` (`quiz_id`),
  KEY `idx_qa_user` (`user_id`),
  KEY `idx_qa_status` (`status`),
  CONSTRAINT `fk_qa_quiz` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qa_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `quiz_questions`
--

DROP TABLE IF EXISTS `quiz_questions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quiz_questions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `quiz_id` int(10) unsigned NOT NULL,
  `type` enum('mcq','multiple','true_false','short_answer','coding') NOT NULL DEFAULT 'mcq',
  `question_text` text NOT NULL,
  `question_image` varchar(255) DEFAULT NULL,
  `code_snippet` text DEFAULT NULL,
  `options` longtext DEFAULT NULL,
  `correct_answer` longtext DEFAULT NULL,
  `coding_languages` longtext DEFAULT NULL,
  `starter_code` longtext DEFAULT NULL,
  `test_cases` longtext DEFAULT NULL,
  `time_limit_ms` int(10) unsigned NOT NULL DEFAULT 2000,
  `memory_limit_kb` int(10) unsigned NOT NULL DEFAULT 262144,
  `time_limit_seconds` int(11) DEFAULT NULL,
  `marks` int(11) NOT NULL DEFAULT 1,
  `negative_marks` decimal(4,2) NOT NULL DEFAULT 0.00,
  `difficulty` enum('easy','medium','hard') NOT NULL DEFAULT 'easy',
  `explanation` text DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_qq_quiz` (`quiz_id`),
  CONSTRAINT `fk_qq_quiz` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `quizzes`
--

DROP TABLE IF EXISTS `quizzes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `quizzes` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `slug` varchar(220) NOT NULL,
  `description` text DEFAULT NULL,
  `category_id` int(10) unsigned DEFAULT NULL,
  `course_id` int(10) unsigned DEFAULT NULL,
  `module_id` int(10) unsigned DEFAULT NULL,
  `difficulty` enum('easy','medium','hard') NOT NULL DEFAULT 'easy',
  `quiz_type` enum('normal','live','practice') NOT NULL DEFAULT 'normal',
  `total_marks` int(10) unsigned NOT NULL DEFAULT 0,
  `question_count` int(10) unsigned NOT NULL DEFAULT 0,
  `negative_marking` decimal(4,2) NOT NULL DEFAULT 0.00,
  `time_limit_minutes` int(10) unsigned NOT NULL DEFAULT 15,
  `passing_score` int(10) unsigned NOT NULL DEFAULT 40,
  `start_at` datetime DEFAULT NULL,
  `end_at` datetime DEFAULT NULL,
  `max_participants` int(10) unsigned DEFAULT NULL,
  `status` enum('draft','scheduled','published','live','completed','unpublished') NOT NULL DEFAULT 'draft',
  `live_started_at` datetime DEFAULT NULL,
  `live_ended_at` datetime DEFAULT NULL,
  `shuffle_questions` tinyint(1) NOT NULL DEFAULT 0,
  `show_answers_after` tinyint(1) NOT NULL DEFAULT 1,
  `allow_reattempt` tinyint(1) NOT NULL DEFAULT 0,
  `is_private` tinyint(1) NOT NULL DEFAULT 0,
  `is_premium` tinyint(1) NOT NULL DEFAULT 0,
  `access_password` varchar(255) DEFAULT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `live_host_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `require_all_viewed` tinyint(1) NOT NULL DEFAULT 0,
  `individualized_order` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_quizzes_slug` (`slug`),
  KEY `idx_quizzes_status` (`status`),
  KEY `idx_quizzes_type` (`quiz_type`),
  KEY `idx_quizzes_course` (`course_id`),
  KEY `fk_quizzes_category` (`category_id`),
  KEY `fk_quizzes_creator` (`created_by`),
  KEY `idx_quizzes_module` (`module_id`),
  CONSTRAINT `fk_quizzes_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_quizzes_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reports`
--

DROP TABLE IF EXISTS `reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reports` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `report_type` enum('users','courses','quizzes','coding','contests','revenue','activity') NOT NULL,
  `title` varchar(180) NOT NULL,
  `description` varchar(400) DEFAULT NULL,
  `payload` longtext DEFAULT NULL,
  `period_start` date DEFAULT NULL,
  `period_end` date DEFAULT NULL,
  `generated_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_report_type` (`report_type`),
  KEY `fk_report_user` (`generated_by`),
  CONSTRAINT `fk_report_user` FOREIGN KEY (`generated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `roles`
--

DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(40) NOT NULL,
  `slug` varchar(40) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_slug` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `settings` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(80) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `group_name` varchar(60) NOT NULL DEFAULT 'general',
  `input_type` enum('text','textarea','number','boolean','select','color','url','file') NOT NULL DEFAULT 'text',
  `label` varchar(140) NOT NULL,
  `updated_by` int(10) unsigned DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_setting_key` (`setting_key`),
  KEY `idx_setting_group` (`group_name`)
) ENGINE=InnoDB AUTO_INCREMENT=122 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `site_pages`
--

DROP TABLE IF EXISTS `site_pages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `site_pages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(60) NOT NULL,
  `title` varchar(160) NOT NULL,
  `eyebrow` varchar(80) NOT NULL DEFAULT '',
  `summary` varchar(400) NOT NULL DEFAULT '',
  `page_type` enum('legal','faq') NOT NULL DEFAULT 'legal',
  `body` longtext NOT NULL,
  `footer_group` enum('legal','support','none') NOT NULL DEFAULT 'legal',
  `sort_order` int(11) NOT NULL DEFAULT 100,
  `is_published` tinyint(1) NOT NULL DEFAULT 1,
  `is_builtin` tinyint(1) NOT NULL DEFAULT 0,
  `updated_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_sp_pub` (`is_published`,`footer_group`,`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `subscription_orders`
--

DROP TABLE IF EXISTS `subscription_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscription_orders` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `kind` enum('subscription','course') NOT NULL DEFAULT 'subscription',
  `plan_id` int(10) unsigned DEFAULT NULL,
  `course_id` int(10) unsigned DEFAULT NULL,
  `amount_paise` int(10) unsigned NOT NULL DEFAULT 0,
  `currency` varchar(8) NOT NULL DEFAULT 'INR',
  `gateway` enum('razorpay','paytm','demo','manual','upi') NOT NULL DEFAULT 'demo',
  `status` enum('created','paid','failed','cancelled','pending_review') NOT NULL DEFAULT 'created',
  `gateway_order_id` varchar(64) DEFAULT NULL,
  `gateway_payment_id` varchar(64) DEFAULT NULL,
  `upi_reference` varchar(40) DEFAULT NULL,
  `upi_utr` varchar(40) DEFAULT NULL,
  `upi_utr_claim` varchar(40) GENERATED ALWAYS AS (case when `status` in ('paid','pending_review') and `upi_utr` is not null and `upi_utr` <> '' then ucase(`upi_utr`) else NULL end) VIRTUAL,
  `upi_payer_vpa` varchar(120) DEFAULT NULL,
  `upi_submitted_at` datetime DEFAULT NULL,
  `upi_reviewed_by` int(11) DEFAULT NULL,
  `upi_reviewed_at` datetime DEFAULT NULL,
  `upi_review_note` varchar(255) DEFAULT NULL,
  `subscription_id` int(10) unsigned DEFAULT NULL,
  `enrollment_id` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `paid_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_so_upi_utr_claim` (`upi_utr_claim`),
  KEY `ix_so_user` (`user_id`),
  KEY `ix_so_gw` (`gateway_order_id`),
  KEY `fk_so_plan` (`plan_id`),
  CONSTRAINT `fk_so_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`),
  CONSTRAINT `fk_so_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `subscriptions`
--

DROP TABLE IF EXISTS `subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscriptions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `plan_id` int(10) unsigned NOT NULL,
  `status` enum('active','expired','cancelled') NOT NULL DEFAULT 'active',
  `starts_at` datetime NOT NULL,
  `ends_at` datetime NOT NULL,
  `order_id` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `ix_sub_user` (`user_id`,`status`,`ends_at`),
  KEY `fk_membership_plan` (`plan_id`),
  KEY `fk_membership_order` (`order_id`),
  CONSTRAINT `fk_membership_order` FOREIGN KEY (`order_id`) REFERENCES `subscription_orders` (`id`),
  CONSTRAINT `fk_membership_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`),
  CONSTRAINT `fk_membership_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_achievements`
--

DROP TABLE IF EXISTS `user_achievements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_achievements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `achievement_id` int(10) unsigned NOT NULL,
  `awarded_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_achievement` (`user_id`,`achievement_id`),
  KEY `fk_ua_achievement` (`achievement_id`),
  CONSTRAINT `fk_ua_achievement` FOREIGN KEY (`achievement_id`) REFERENCES `achievements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ua_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_anticheat_settings`
--

DROP TABLE IF EXISTS `user_anticheat_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_anticheat_settings` (
  `user_id` int(10) unsigned NOT NULL,
  `settings_json` longtext DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_uac_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_hint_unlocks`
--

DROP TABLE IF EXISTS `user_hint_unlocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_hint_unlocks` (
  `user_id` int(10) unsigned NOT NULL,
  `problem_id` int(10) unsigned NOT NULL,
  `unlocked_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`,`problem_id`),
  KEY `fk_hint_problem` (`problem_id`),
  CONSTRAINT `fk_hint_problem` FOREIGN KEY (`problem_id`) REFERENCES `coding_problems` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hint_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_permissions`
--

DROP TABLE IF EXISTS `user_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_permissions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `permission_id` int(10) unsigned NOT NULL,
  `allowed` tinyint(1) NOT NULL DEFAULT 1,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_permission` (`user_id`,`permission_id`),
  KEY `idx_up_permission` (`permission_id`),
  CONSTRAINT `fk_up_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_sessions`
--

DROP TABLE IF EXISTS `user_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_sessions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int(10) unsigned NOT NULL,
  `refresh_token` varchar(255) NOT NULL,
  `previous_refresh_token` varchar(255) DEFAULT NULL,
  `refresh_rotated_at` datetime DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `ip_address` varchar(60) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `revoked` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_token` (`refresh_token`),
  KEY `idx_session_user` (`user_id`),
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `full_name` varchar(120) NOT NULL,
  `email` varchar(160) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  `role_id` int(10) unsigned NOT NULL,
  `avatar` varchar(255) DEFAULT NULL,
  `college` varchar(160) DEFAULT NULL,
  `bio` varchar(500) DEFAULT NULL,
  `github_url` varchar(255) DEFAULT NULL,
  `linkedin_url` varchar(255) DEFAULT NULL,
  `provider` enum('local','google','github') NOT NULL DEFAULT 'local',
  `provider_id` varchar(191) DEFAULT NULL,
  `status` enum('active','pending','suspended') NOT NULL DEFAULT 'active',
  `email_verified` tinyint(1) NOT NULL DEFAULT 0,
  `points` int(11) NOT NULL DEFAULT 0,
  `problems_solved` int(11) NOT NULL DEFAULT 0,
  `quizzes_completed` int(11) NOT NULL DEFAULT 0,
  `courses_completed` int(11) NOT NULL DEFAULT 0,
  `streak_days` int(11) NOT NULL DEFAULT 0,
  `reset_token` varchar(255) DEFAULT NULL,
  `reset_token_expires` datetime DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `streak_best` int(10) unsigned NOT NULL DEFAULT 0,
  `last_activity_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_provider` (`provider`,`provider_id`),
  KEY `idx_users_role` (`role_id`),
  KEY `idx_users_status` (`status`),
  KEY `idx_users_points` (`points`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Reference data (roles, permissions, settings, plans, categories, pages…)
-- Demo/learner data (courses, lessons, quizzes, users) is NOT included — use
-- database/let-us-c-demo.sql for the Let Us C demo.
--

--
-- Dumping data for table `achievements`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `achievements` WRITE;
/*!40000 ALTER TABLE `achievements` DISABLE KEYS */;
/*!40000 ALTER TABLE `achievements` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `app_meta`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `app_meta` WRITE;
/*!40000 ALTER TABLE `app_meta` DISABLE KEYS */;
INSERT INTO `app_meta` VALUES
('points_formula_version','2','2026-10-31 07:45:41');
/*!40000 ALTER TABLE `app_meta` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `categories`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` VALUES
(1,'Programming','programming','course','Programming courses',NULL,'2026-10-31 07:45:41');
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `certificate_templates`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `certificate_templates` WRITE;
/*!40000 ALTER TABLE `certificate_templates` DISABLE KEYS */;
INSERT INTO `certificate_templates` VALUES
(1,'gold-course','Gold — Course Completion','course','Certificate of Completion','has successfully completed all modules and lessons of the course','Awarded to','★ VERIFIED','Course Completion',NULL,'#0f172a','#0b1020','#fbbf24','#fde68a','#f59e0b','#fbbf24','#b45309','#fde68a',1,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(2,'blue-quiz','Blue — Quiz Excellence','quiz','Certificate of Excellence','by achieving {{score}} in the quiz:','Presented to','✓ EXCELLENCE','Quiz Excellence',NULL,'#0a1530','#070f22','#60a5fa','#93c5fd','#22d3ee','#60a5fa','#1d4ed8','#bfdbfe',1,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(3,'red-contest','Crimson — Contest Champion','contest','Certificate of Championship','for outstanding performance in the contest:','Awarded to','♔ CHAMPION','Contest Champion',NULL,'#1a0b10','#0b0508','#f87171','#fecaca','#fb7185','#f87171','#991b1b','#fecaca',1,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(4,'green-milestone','Emerald — Coding Milestone','milestone','Coding Milestone','by reaching the milestone {{tier}} on the platform.','Earned by','⟨/⟩ MASTERED','Coding Milestone',NULL,'#06140f','#040b08','#4ade80','#bbf7d0','#22c55e','#4ade80','#166534','#bbf7d0',1,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(5,'violet-programme','Violet — Programme Completion','path','Programme Completed','for completing every required course in the programme:','Awarded to','✓ PATH COMPLETE','Programme Completion',NULL,'#160d2e','#0b1020','#a78bfa','#ddd6fe','#818cf8','#a78bfa','#5b21b6','#ddd6fe',1,1,1,NULL,'2026-10-31 07:45:41','2026-10-31 07:45:41');
/*!40000 ALTER TABLE `certificate_templates` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `certificates`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `certificates` WRITE;
/*!40000 ALTER TABLE `certificates` DISABLE KEYS */;
/*!40000 ALTER TABLE `certificates` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `coding_languages`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `coding_languages` WRITE;
/*!40000 ALTER TABLE `coding_languages` DISABLE KEYS */;
INSERT INTO `coding_languages` VALUES
(1,'C','c',50,'c','gcc','gcc 14','#include <stdio.h>\nint main(void) { return 0; }',1),
(2,'C++','cpp',54,'cpp','gpp','g++ 14','#include <bits/stdc++.h>\nusing namespace std;\nint main() { return 0; }',1),
(3,'Java','java',62,'java','java','OpenJDK 21','import java.util.*;\npublic class Main { public static void main(String[] args) { } }',1),
(4,'Python','python',71,'python','python','Python 3.13','def main():\n    pass\n\nif __name__ == \"__main__\":\n    main()',1),
(5,'JavaScript','javascript',63,'javascript','node','Node 20','const input = require(\"fs\").readFileSync(0, \"utf8\").trim();',1),
(6,'SQL','sql',82,'sql',NULL,'MariaDB 11','-- Write your query here',0);
/*!40000 ALTER TABLE `coding_languages` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `coding_problems`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `coding_problems` WRITE;
/*!40000 ALTER TABLE `coding_problems` DISABLE KEYS */;
/*!40000 ALTER TABLE `coding_problems` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `coding_submission_results`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `coding_submission_results` WRITE;
/*!40000 ALTER TABLE `coding_submission_results` DISABLE KEYS */;
/*!40000 ALTER TABLE `coding_submission_results` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `coding_submissions`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `coding_submissions` WRITE;
/*!40000 ALTER TABLE `coding_submissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `coding_submissions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `coding_test_cases`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `coding_test_cases` WRITE;
/*!40000 ALTER TABLE `coding_test_cases` DISABLE KEYS */;
/*!40000 ALTER TABLE `coding_test_cases` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `contest_participants`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `contest_participants` WRITE;
/*!40000 ALTER TABLE `contest_participants` DISABLE KEYS */;
/*!40000 ALTER TABLE `contest_participants` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `contest_problems`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `contest_problems` WRITE;
/*!40000 ALTER TABLE `contest_problems` DISABLE KEYS */;
/*!40000 ALTER TABLE `contest_problems` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `contests`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `contests` WRITE;
/*!40000 ALTER TABLE `contests` DISABLE KEYS */;
/*!40000 ALTER TABLE `contests` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `course_reviews`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `course_reviews` WRITE;
/*!40000 ALTER TABLE `course_reviews` DISABLE KEYS */;
/*!40000 ALTER TABLE `course_reviews` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `discussion_replies`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `discussion_replies` WRITE;
/*!40000 ALTER TABLE `discussion_replies` DISABLE KEYS */;
/*!40000 ALTER TABLE `discussion_replies` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `discussions`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `discussions` WRITE;
/*!40000 ALTER TABLE `discussions` DISABLE KEYS */;
/*!40000 ALTER TABLE `discussions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `landing_media`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `landing_media` WRITE;
/*!40000 ALTER TABLE `landing_media` DISABLE KEYS */;
/*!40000 ALTER TABLE `landing_media` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `landing_page_builder`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `landing_page_builder` WRITE;
/*!40000 ALTER TABLE `landing_page_builder` DISABLE KEYS */;
INSERT INTO `landing_page_builder` VALUES
(1,'{\"schemaVersion\":1,\"theme\":{\"primaryColor\":\"#01507c\",\"accentColor\":\"#f5a800\",\"pageBackground\":\"#f5f8fa\",\"pageBackgroundDark\":\"#071722\",\"maxWidth\":1280,\"cornerRadius\":8,\"motion\":true},\"sections\":[{\"id\":\"landing-banner\",\"type\":\"banner\",\"name\":\"Featured banner\",\"enabled\":true,\"style\":{\"background\":\"dark\",\"padding\":\"none\",\"height\":\"medium\",\"alignment\":\"left\",\"overlay\":78},\"content\":{\"eyebrow\":\"Featured at SmartODL\",\"title\":\"Learn with direction. Build with confidence.\",\"subtitle\":\"Guided courses, coding practice and live assessments in one connected learning environment.\",\"image\":\"/banners/smartodl-default-banner.jpg\",\"imageAlt\":\"\",\"primaryButton\":{\"label\":\"Explore courses\",\"link\":\"/courses\"}}},{\"id\":\"main-hero\",\"type\":\"hero\",\"name\":\"Main hero\",\"enabled\":true,\"style\":{\"background\":\"brand\",\"padding\":\"spacious\",\"alignment\":\"left\"},\"content\":{\"eyebrow\":\"College-level learning and coding platform\",\"title\":\"Build skills. Solve problems.\",\"accentTitle\":\"Shape your future.\",\"description\":\"Structured courses, live assessments, competitive programming and an online judge—everything you need to learn with purpose.\",\"primaryButton\":{\"label\":\"Explore courses\",\"link\":\"/courses\"},\"secondaryButton\":{\"label\":\"Open coding arena\",\"link\":\"/coding\"},\"trustPoints\":[\"Guided learning paths\",\"Multi-language judge\",\"Live quizzes & contests\"],\"showCodePreview\":true}},{\"id\":\"technology-marquee\",\"type\":\"technology\",\"name\":\"Technology marquee\",\"enabled\":true,\"style\":{\"background\":\"brand\",\"padding\":\"none\"},\"content\":{\"ariaLabel\":\"Explore programming technologies\",\"technologies\":[{\"name\":\"Python\",\"mark\":\"Py\",\"color\":\"#3776ab\"},{\"name\":\"JavaScript\",\"mark\":\"JS\",\"color\":\"#f7df1e\"},{\"name\":\"TypeScript\",\"mark\":\"TS\",\"color\":\"#3178c6\"},{\"name\":\"React\",\"mark\":\"Re\",\"color\":\"#087ea4\"},{\"name\":\"Next.js\",\"mark\":\"N\",\"color\":\"#111827\"},{\"name\":\"HTML\",\"mark\":\"H5\",\"color\":\"#e34f26\"},{\"name\":\"CSS\",\"mark\":\"C3\",\"color\":\"#1572b6\"},{\"name\":\"Java\",\"mark\":\"J\",\"color\":\"#d93636\"},{\"name\":\"C++\",\"mark\":\"C+\",\"color\":\"#00599c\"},{\"name\":\"SQL\",\"mark\":\"SQL\",\"color\":\"#336791\"},{\"name\":\"C\",\"mark\":\"C\",\"color\":\"#546e7a\"},{\"name\":\"C#\",\"mark\":\"C#\",\"color\":\"#512bd4\"}]}},{\"id\":\"quick-services\",\"type\":\"quick_services\",\"name\":\"Quick access cards\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"none\",\"columns\":4},\"content\":{\"items\":[{\"title\":\"Online Learning\",\"icon\":\"video\",\"links\":[{\"label\":\"My learning dashboard\",\"link\":\"/student\"},{\"label\":\"Continue a course\",\"link\":\"/student/courses\"},{\"label\":\"Virtual classes\",\"link\":\"/quizzes?type=live\"}]},{\"title\":\"Browse Courses\",\"icon\":\"book\",\"links\":[{\"label\":\"Web development\",\"link\":\"/courses\"},{\"label\":\"Programming languages\",\"link\":\"/courses\"},{\"label\":\"Data structures & algorithms\",\"link\":\"/courses\"}]},{\"title\":\"Assessments & Quizzes\",\"icon\":\"quiz\",\"links\":[{\"label\":\"Upcoming quizzes\",\"link\":\"/quizzes\"},{\"label\":\"Join a live quiz\",\"link\":\"/quizzes?type=live\"},{\"label\":\"View my results\",\"link\":\"/student/results\"}]},{\"title\":\"Coding Arena\",\"icon\":\"code\",\"links\":[{\"label\":\"Solve coding problems\",\"link\":\"/coding\"},{\"label\":\"Join contests\",\"link\":\"/contests\"},{\"label\":\"View leaderboard\",\"link\":\"/leaderboard\"}]}]}},{\"id\":\"programmes\",\"type\":\"programmes\",\"name\":\"Programme finder & courses\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\",\"columns\":3},\"content\":{\"eyebrow\":\"Programme finder\",\"title\":\"Find the right learning path\",\"description\":\"Search by subject or technology and discover a course designed around your goal.\",\"searchLabel\":\"What do you want to learn?\",\"searchPlaceholder\":\"Python, React, SQL, data structures…\",\"searchButton\":\"Find programmes\",\"listEyebrow\":\"Popular programmes\",\"listTitle\":\"Start with a learner-favourite course\",\"listLinkLabel\":\"Browse all programmes\",\"listLink\":\"/courses\",\"itemLimit\":6}},{\"id\":\"updates\",\"type\":\"updates\",\"name\":\"Updates & welcome\",\"enabled\":true,\"style\":{\"background\":\"soft\",\"padding\":\"normal\",\"columns\":2},\"content\":{\"eyebrow\":\"Stay informed\",\"title\":\"Latest updates from SmartODL\",\"description\":\"Academic, assessment and competition updates in one clear place.\",\"panelTitle\":\"Announcements\",\"panelLinkLabel\":\"View all\",\"panelLink\":\"/quizzes\",\"welcomeEyebrow\":\"Welcome to SmartODL\",\"welcomeTitle\":\"Learning and practice, connected.\",\"welcomeDescription\":\"Learn concepts through structured modules, apply them in quizzes and coding problems, and understand your progress through meaningful results.\",\"welcomeLinkLabel\":\"Know more about SmartODL\",\"welcomeLink\":\"/about\"}},{\"id\":\"platform-stats\",\"type\":\"stats\",\"name\":\"Platform statistics\",\"enabled\":true,\"style\":{\"background\":\"dark\",\"padding\":\"compact\",\"columns\":5},\"content\":{\"items\":[{\"label\":\"Programmes\",\"source\":\"total_courses\",\"icon\":\"book\"},{\"label\":\"Active learners\",\"source\":\"total_students\",\"icon\":\"users\"},{\"label\":\"Coding problems\",\"source\":\"total_problems\",\"icon\":\"code\"},{\"label\":\"Contest events\",\"source\":\"total_contests\",\"icon\":\"trophy\"},{\"label\":\"Submissions\",\"source\":\"total_submissions\",\"icon\":\"rocket\"}]}},{\"id\":\"learning-schools\",\"type\":\"schools\",\"name\":\"Learning schools\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\",\"columns\":4},\"content\":{\"eyebrow\":\"Explore by subject\",\"title\":\"Learning schools\",\"description\":\"Move from core concepts to practical projects and assessments.\",\"itemLinkLabel\":\"View programmes\",\"items\":[{\"title\":\"Web Development\",\"description\":\"HTML, CSS, JavaScript, React and project-based frontend learning.\",\"icon\":\"laptop\",\"link\":\"/courses?category=web\"},{\"title\":\"Data Structures & Algorithms\",\"description\":\"Build problem-solving ability through structured concepts and practice.\",\"icon\":\"chart\",\"link\":\"/courses?category=dsa\"},{\"title\":\"Programming Languages\",\"description\":\"Learn C, C++, Java, Python and JavaScript with executable examples.\",\"icon\":\"code\",\"link\":\"/courses?category=programming\"},{\"title\":\"Database Systems\",\"description\":\"Master SQL, relational design and practical data management skills.\",\"icon\":\"database\",\"link\":\"/courses?category=database\"}]}},{\"id\":\"competition\",\"type\":\"competition\",\"name\":\"Practice & compete\",\"enabled\":true,\"style\":{\"background\":\"soft\",\"padding\":\"normal\",\"columns\":2},\"content\":{\"eyebrow\":\"Practice and compete\",\"title\":\"Live opportunities to test your skills\",\"listTitle\":\"Upcoming contests\",\"listLinkLabel\":\"All contests\",\"listLink\":\"/contests\",\"problemEyebrow\":\"Problem of the day\",\"problemDescription\":\"Build a consistent practice habit with one focused challenge.\",\"problemButton\":\"Solve today\",\"emptyTitle\":\"Daily coding practice\",\"emptyDescription\":\"Open the arena and choose a problem matched to your current level.\",\"emptyButton\":\"Open coding arena\"}},{\"id\":\"popular-problems\",\"type\":\"problems\",\"name\":\"Popular coding challenges\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\"},\"content\":{\"eyebrow\":\"Coding arena\",\"title\":\"Popular coding challenges\",\"linkLabel\":\"Open the arena\",\"link\":\"/coding\",\"itemLimit\":6}},{\"id\":\"student-services\",\"type\":\"student_services\",\"name\":\"Student services\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\",\"columns\":6},\"content\":{\"eyebrow\":\"Quick access\",\"title\":\"Student services\",\"description\":\"Frequently used academic services available from one place.\",\"items\":[{\"label\":\"My Courses\",\"icon\":\"book\",\"link\":\"/student/courses\"},{\"label\":\"Academic Calendar\",\"icon\":\"calendar\",\"link\":\"/contests\"},{\"label\":\"Study Notes\",\"icon\":\"file\",\"link\":\"/notes\"},{\"label\":\"Results\",\"icon\":\"report\",\"link\":\"/student/results\"},{\"label\":\"Certificates\",\"icon\":\"certificate\",\"link\":\"/student/certificates\"},{\"label\":\"Help & Support\",\"icon\":\"help\",\"link\":\"/contact\"}]}},{\"id\":\"final-cta\",\"type\":\"cta\",\"name\":\"Final call to action\",\"enabled\":true,\"style\":{\"background\":\"brand\",\"padding\":\"compact\",\"alignment\":\"left\"},\"content\":{\"title\":\"Ready to begin your learning journey?\",\"description\":\"Create your account and start with a guided course or coding problem.\",\"guestButton\":\"Create account\",\"guestLink\":\"/register\",\"userButton\":\"Go to dashboard\"}}]}','{\"schemaVersion\":1,\"theme\":{\"primaryColor\":\"#01507c\",\"accentColor\":\"#f5a800\",\"pageBackground\":\"#f5f8fa\",\"pageBackgroundDark\":\"#071722\",\"maxWidth\":1280,\"cornerRadius\":8,\"motion\":true},\"sections\":[{\"id\":\"landing-banner\",\"type\":\"banner\",\"name\":\"Featured banner\",\"enabled\":true,\"style\":{\"background\":\"dark\",\"padding\":\"none\",\"height\":\"medium\",\"alignment\":\"left\",\"overlay\":78},\"content\":{\"eyebrow\":\"Featured at SmartODL\",\"title\":\"Learn with direction. Build with confidence.\",\"subtitle\":\"Guided courses, coding practice and live assessments in one connected learning environment.\",\"image\":\"/banners/smartodl-default-banner.jpg\",\"imageAlt\":\"\",\"primaryButton\":{\"label\":\"Explore courses\",\"link\":\"/courses\"}}},{\"id\":\"main-hero\",\"type\":\"hero\",\"name\":\"Main hero\",\"enabled\":true,\"style\":{\"background\":\"brand\",\"padding\":\"spacious\",\"alignment\":\"left\"},\"content\":{\"eyebrow\":\"College-level learning and coding platform\",\"title\":\"Build skills. Solve problems.\",\"accentTitle\":\"Shape your future.\",\"description\":\"Structured courses, live assessments, competitive programming and an online judge—everything you need to learn with purpose.\",\"primaryButton\":{\"label\":\"Explore courses\",\"link\":\"/courses\"},\"secondaryButton\":{\"label\":\"Open coding arena\",\"link\":\"/coding\"},\"trustPoints\":[\"Guided learning paths\",\"Multi-language judge\",\"Live quizzes & contests\"],\"showCodePreview\":true}},{\"id\":\"technology-marquee\",\"type\":\"technology\",\"name\":\"Technology marquee\",\"enabled\":true,\"style\":{\"background\":\"brand\",\"padding\":\"none\"},\"content\":{\"ariaLabel\":\"Explore programming technologies\",\"technologies\":[{\"name\":\"Python\",\"mark\":\"Py\",\"color\":\"#3776ab\"},{\"name\":\"JavaScript\",\"mark\":\"JS\",\"color\":\"#f7df1e\"},{\"name\":\"TypeScript\",\"mark\":\"TS\",\"color\":\"#3178c6\"},{\"name\":\"React\",\"mark\":\"Re\",\"color\":\"#087ea4\"},{\"name\":\"Next.js\",\"mark\":\"N\",\"color\":\"#111827\"},{\"name\":\"HTML\",\"mark\":\"H5\",\"color\":\"#e34f26\"},{\"name\":\"CSS\",\"mark\":\"C3\",\"color\":\"#1572b6\"},{\"name\":\"Java\",\"mark\":\"J\",\"color\":\"#d93636\"},{\"name\":\"C++\",\"mark\":\"C+\",\"color\":\"#00599c\"},{\"name\":\"SQL\",\"mark\":\"SQL\",\"color\":\"#336791\"},{\"name\":\"C\",\"mark\":\"C\",\"color\":\"#546e7a\"},{\"name\":\"C#\",\"mark\":\"C#\",\"color\":\"#512bd4\"}]}},{\"id\":\"quick-services\",\"type\":\"quick_services\",\"name\":\"Quick access cards\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"none\",\"columns\":4},\"content\":{\"items\":[{\"title\":\"Online Learning\",\"icon\":\"video\",\"links\":[{\"label\":\"My learning dashboard\",\"link\":\"/student\"},{\"label\":\"Continue a course\",\"link\":\"/student/courses\"},{\"label\":\"Virtual classes\",\"link\":\"/quizzes?type=live\"}]},{\"title\":\"Browse Courses\",\"icon\":\"book\",\"links\":[{\"label\":\"Web development\",\"link\":\"/courses\"},{\"label\":\"Programming languages\",\"link\":\"/courses\"},{\"label\":\"Data structures & algorithms\",\"link\":\"/courses\"}]},{\"title\":\"Assessments & Quizzes\",\"icon\":\"quiz\",\"links\":[{\"label\":\"Upcoming quizzes\",\"link\":\"/quizzes\"},{\"label\":\"Join a live quiz\",\"link\":\"/quizzes?type=live\"},{\"label\":\"View my results\",\"link\":\"/student/results\"}]},{\"title\":\"Coding Arena\",\"icon\":\"code\",\"links\":[{\"label\":\"Solve coding problems\",\"link\":\"/coding\"},{\"label\":\"Join contests\",\"link\":\"/contests\"},{\"label\":\"View leaderboard\",\"link\":\"/leaderboard\"}]}]}},{\"id\":\"programmes\",\"type\":\"programmes\",\"name\":\"Programme finder & courses\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\",\"columns\":3},\"content\":{\"eyebrow\":\"Programme finder\",\"title\":\"Find the right learning path\",\"description\":\"Search by subject or technology and discover a course designed around your goal.\",\"searchLabel\":\"What do you want to learn?\",\"searchPlaceholder\":\"Python, React, SQL, data structures…\",\"searchButton\":\"Find programmes\",\"listEyebrow\":\"Popular programmes\",\"listTitle\":\"Start with a learner-favourite course\",\"listLinkLabel\":\"Browse all programmes\",\"listLink\":\"/courses\",\"itemLimit\":6}},{\"id\":\"updates\",\"type\":\"updates\",\"name\":\"Updates & welcome\",\"enabled\":true,\"style\":{\"background\":\"soft\",\"padding\":\"normal\",\"columns\":2},\"content\":{\"eyebrow\":\"Stay informed\",\"title\":\"Latest updates from SmartODL\",\"description\":\"Academic, assessment and competition updates in one clear place.\",\"panelTitle\":\"Announcements\",\"panelLinkLabel\":\"View all\",\"panelLink\":\"/quizzes\",\"welcomeEyebrow\":\"Welcome to SmartODL\",\"welcomeTitle\":\"Learning and practice, connected.\",\"welcomeDescription\":\"Learn concepts through structured modules, apply them in quizzes and coding problems, and understand your progress through meaningful results.\",\"welcomeLinkLabel\":\"Know more about SmartODL\",\"welcomeLink\":\"/about\"}},{\"id\":\"platform-stats\",\"type\":\"stats\",\"name\":\"Platform statistics\",\"enabled\":true,\"style\":{\"background\":\"dark\",\"padding\":\"compact\",\"columns\":5},\"content\":{\"items\":[{\"label\":\"Programmes\",\"source\":\"total_courses\",\"icon\":\"book\"},{\"label\":\"Active learners\",\"source\":\"total_students\",\"icon\":\"users\"},{\"label\":\"Coding problems\",\"source\":\"total_problems\",\"icon\":\"code\"},{\"label\":\"Contest events\",\"source\":\"total_contests\",\"icon\":\"trophy\"},{\"label\":\"Submissions\",\"source\":\"total_submissions\",\"icon\":\"rocket\"}]}},{\"id\":\"learning-schools\",\"type\":\"schools\",\"name\":\"Learning schools\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\",\"columns\":4},\"content\":{\"eyebrow\":\"Explore by subject\",\"title\":\"Learning schools\",\"description\":\"Move from core concepts to practical projects and assessments.\",\"itemLinkLabel\":\"View programmes\",\"items\":[{\"title\":\"Web Development\",\"description\":\"HTML, CSS, JavaScript, React and project-based frontend learning.\",\"icon\":\"laptop\",\"link\":\"/courses?category=web\"},{\"title\":\"Data Structures & Algorithms\",\"description\":\"Build problem-solving ability through structured concepts and practice.\",\"icon\":\"chart\",\"link\":\"/courses?category=dsa\"},{\"title\":\"Programming Languages\",\"description\":\"Learn C, C++, Java, Python and JavaScript with executable examples.\",\"icon\":\"code\",\"link\":\"/courses?category=programming\"},{\"title\":\"Database Systems\",\"description\":\"Master SQL, relational design and practical data management skills.\",\"icon\":\"database\",\"link\":\"/courses?category=database\"}]}},{\"id\":\"competition\",\"type\":\"competition\",\"name\":\"Practice & compete\",\"enabled\":true,\"style\":{\"background\":\"soft\",\"padding\":\"normal\",\"columns\":2},\"content\":{\"eyebrow\":\"Practice and compete\",\"title\":\"Live opportunities to test your skills\",\"listTitle\":\"Upcoming contests\",\"listLinkLabel\":\"All contests\",\"listLink\":\"/contests\",\"problemEyebrow\":\"Problem of the day\",\"problemDescription\":\"Build a consistent practice habit with one focused challenge.\",\"problemButton\":\"Solve today\",\"emptyTitle\":\"Daily coding practice\",\"emptyDescription\":\"Open the arena and choose a problem matched to your current level.\",\"emptyButton\":\"Open coding arena\"}},{\"id\":\"popular-problems\",\"type\":\"problems\",\"name\":\"Popular coding challenges\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\"},\"content\":{\"eyebrow\":\"Coding arena\",\"title\":\"Popular coding challenges\",\"linkLabel\":\"Open the arena\",\"link\":\"/coding\",\"itemLimit\":6}},{\"id\":\"student-services\",\"type\":\"student_services\",\"name\":\"Student services\",\"enabled\":true,\"style\":{\"background\":\"default\",\"padding\":\"normal\",\"columns\":6},\"content\":{\"eyebrow\":\"Quick access\",\"title\":\"Student services\",\"description\":\"Frequently used academic services available from one place.\",\"items\":[{\"label\":\"My Courses\",\"icon\":\"book\",\"link\":\"/student/courses\"},{\"label\":\"Academic Calendar\",\"icon\":\"calendar\",\"link\":\"/contests\"},{\"label\":\"Study Notes\",\"icon\":\"file\",\"link\":\"/notes\"},{\"label\":\"Results\",\"icon\":\"report\",\"link\":\"/student/results\"},{\"label\":\"Certificates\",\"icon\":\"certificate\",\"link\":\"/student/certificates\"},{\"label\":\"Help & Support\",\"icon\":\"help\",\"link\":\"/contact\"}]}},{\"id\":\"final-cta\",\"type\":\"cta\",\"name\":\"Final call to action\",\"enabled\":true,\"style\":{\"background\":\"brand\",\"padding\":\"compact\",\"alignment\":\"left\"},\"content\":{\"title\":\"Ready to begin your learning journey?\",\"description\":\"Create your account and start with a guided course or coding problem.\",\"guestButton\":\"Create account\",\"guestLink\":\"/register\",\"userButton\":\"Go to dashboard\"}}]}',1,1,NULL,NULL,'2026-10-31 07:45:41','2026-10-31 07:45:41','2026-10-31 07:45:41');
/*!40000 ALTER TABLE `landing_page_builder` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `landing_page_revisions`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `landing_page_revisions` WRITE;
/*!40000 ALTER TABLE `landing_page_revisions` DISABLE KEYS */;
/*!40000 ALTER TABLE `landing_page_revisions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `lesson_opens`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `lesson_opens` WRITE;
/*!40000 ALTER TABLE `lesson_opens` DISABLE KEYS */;
/*!40000 ALTER TABLE `lesson_opens` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `lesson_progress`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `lesson_progress` WRITE;
/*!40000 ALTER TABLE `lesson_progress` DISABLE KEYS */;
/*!40000 ALTER TABLE `lesson_progress` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `lesson_watch`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `lesson_watch` WRITE;
/*!40000 ALTER TABLE `lesson_watch` DISABLE KEYS */;
/*!40000 ALTER TABLE `lesson_watch` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `lesson_watch_buckets`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `lesson_watch_buckets` WRITE;
/*!40000 ALTER TABLE `lesson_watch_buckets` DISABLE KEYS */;
/*!40000 ALTER TABLE `lesson_watch_buckets` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `notes`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `notes` WRITE;
/*!40000 ALTER TABLE `notes` DISABLE KEYS */;
/*!40000 ALTER TABLE `notes` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `notification_reads`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `notification_reads` WRITE;
/*!40000 ALTER TABLE `notification_reads` DISABLE KEYS */;
/*!40000 ALTER TABLE `notification_reads` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `permissions`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT INTO `permissions` VALUES
(1,'create_course','Create Course','courses','Create new courses','2026-10-31 07:45:41'),
(2,'edit_course','Edit Course','courses','Edit courses','2026-10-31 07:45:41'),
(3,'delete_course','Delete Course','courses','Delete courses','2026-10-31 07:45:41'),
(4,'upload_notes','Upload Notes','notes','Upload study material','2026-10-31 07:45:41'),
(5,'create_quiz','Create Quiz','quizzes','Create quizzes','2026-10-31 07:45:41'),
(6,'host_quiz','Host Live Quiz','quizzes','Start and host live quizzes','2026-10-31 07:45:41'),
(7,'create_problem','Create Coding Problem','coding','Create coding problems','2026-10-31 07:45:41'),
(8,'create_contest','Create Contest','contests','Host coding contests','2026-10-31 07:45:41'),
(9,'view_student_data','View Student Data','analytics','View student performance data','2026-10-31 07:45:41'),
(10,'view_submissions','View Submissions','coding','View code submissions','2026-10-31 07:45:41'),
(11,'manage_anticheat','Manage Anti-cheat','quizzes','Turn tab guard, fullscreen lockdown, copy-paste blocking, screenshot blocking and AI detection on or off','2026-10-31 07:45:41');
/*!40000 ALTER TABLE `permissions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `plans`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `plans` WRITE;
/*!40000 ALTER TABLE `plans` DISABLE KEYS */;
INSERT INTO `plans` VALUES
(1,'Free Starter','free-starter','Try premium features for 7 days — no card required.','[\"7-day premium trial\",\"No card or payment required\",\"Demo of premium features\"]',0,7,0,1,'active',NULL,'2026-10-31 07:45:41','2026-10-31 07:45:41'),
(2,'Pro Monthly','pro-monthly','One month of full premium access — courses, quizzes, and coding problems.','[\"All premium courses\",\"Premium quizzes unlocked\",\"Premium coding problems\",\"Priority doubt support\"]',19900,30,1,2,'active',NULL,'2026-10-31 07:45:41','2026-10-31 07:45:41'),
(3,'Pro Max (6 months)','pro-max','Six months of premium access — the best value.','[\"All Pro benefits\",\"Valid for 6 months\",\"Lowest monthly cost\"]',49900,180,0,3,'active',NULL,'2026-10-31 07:45:41','2026-10-31 07:45:41');
/*!40000 ALTER TABLE `plans` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `point_adjustments`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `point_adjustments` WRITE;
/*!40000 ALTER TABLE `point_adjustments` DISABLE KEYS */;
/*!40000 ALTER TABLE `point_adjustments` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `proctor_events`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `proctor_events` WRITE;
/*!40000 ALTER TABLE `proctor_events` DISABLE KEYS */;
/*!40000 ALTER TABLE `proctor_events` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `proctor_recording_files`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `proctor_recording_files` WRITE;
/*!40000 ALTER TABLE `proctor_recording_files` DISABLE KEYS */;
/*!40000 ALTER TABLE `proctor_recording_files` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `proctor_recording_sessions`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `proctor_recording_sessions` WRITE;
/*!40000 ALTER TABLE `proctor_recording_sessions` DISABLE KEYS */;
/*!40000 ALTER TABLE `proctor_recording_sessions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `quiz_answers`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `quiz_answers` WRITE;
/*!40000 ALTER TABLE `quiz_answers` DISABLE KEYS */;
/*!40000 ALTER TABLE `quiz_answers` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `quiz_attempts`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `quiz_attempts` WRITE;
/*!40000 ALTER TABLE `quiz_attempts` DISABLE KEYS */;
/*!40000 ALTER TABLE `quiz_attempts` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `reports`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `reports` WRITE;
/*!40000 ALTER TABLE `reports` DISABLE KEYS */;
/*!40000 ALTER TABLE `reports` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `roles`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES
(1,'Administrator','admin','Full control over the platform except protected Owner accounts','2026-10-31 07:45:41','2026-10-31 07:45:41'),
(2,'Developer','developer','Creates and manages approved learning content','2026-10-31 07:45:41','2026-10-31 07:45:41'),
(3,'Student','student','Learns, attempts assessments and solves coding problems','2026-10-31 07:45:41','2026-10-31 07:45:41'),
(4,'Owner','owner','Protected platform owner with complete administrative access','2026-10-31 07:45:41','2026-10-31 07:45:41');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `settings`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `settings` WRITE;
/*!40000 ALTER TABLE `settings` DISABLE KEYS */;
INSERT INTO `settings` VALUES
(1,'site_name','SmartODL','general','text','Website name',NULL,'2026-10-31 07:45:41'),
(2,'site_tagline','Learn. Code. Compete. Grow.','general','text','Tagline',NULL,'2026-10-31 07:45:41'),
(3,'site_description','A connected platform for structured learning, assessments and coding practice.','general','textarea','Website description',NULL,'2026-10-31 07:45:41'),
(4,'site_logo','/logo.svg','general','file','Logo URL',NULL,'2026-10-31 07:45:41'),
(5,'site_favicon','/favicon.svg','general','file','Favicon URL',NULL,'2026-10-31 07:45:41'),
(6,'contact_email','','general','text','Contact email',NULL,'2026-10-31 07:45:41'),
(7,'contact_phone','','general','text','Contact phone',NULL,'2026-10-31 07:45:41'),
(8,'contact_address','','general','text','Address',NULL,'2026-10-31 07:45:41'),
(9,'social_facebook','','social','url','Facebook link',NULL,'2026-10-31 07:45:41'),
(10,'social_twitter','','social','url','Twitter/X link',NULL,'2026-10-31 07:45:41'),
(11,'social_instagram','','social','url','Instagram link',NULL,'2026-10-31 07:45:41'),
(12,'social_linkedin','','social','url','LinkedIn link',NULL,'2026-10-31 07:45:41'),
(13,'social_youtube','','social','url','YouTube link',NULL,'2026-10-31 07:45:41'),
(14,'social_github','','social','url','GitHub link',NULL,'2026-10-31 07:45:41'),
(15,'registration_enabled','1','auth','boolean','Allow new registrations',NULL,'2026-10-31 07:45:41'),
(16,'student_registration','1','auth','boolean','Allow student registration',NULL,'2026-10-31 07:45:41'),
(17,'developer_registration','0','auth','boolean','Allow developer registration',NULL,'2026-10-31 07:45:41'),
(18,'google_login_enabled','0','auth','boolean','Enable Google login',NULL,'2026-10-31 07:45:41'),
(19,'github_login_enabled','0','auth','boolean','Enable GitHub login',NULL,'2026-10-31 07:45:41'),
(20,'quiz_system_enabled','1','features','boolean','Quiz system enabled',NULL,'2026-10-31 07:45:41'),
(21,'live_quiz_enabled','1','features','boolean','Live quiz enabled',NULL,'2026-10-31 07:45:41'),
(22,'coding_system_enabled','1','features','boolean','Coding system enabled',NULL,'2026-10-31 07:45:41'),
(23,'contests_enabled','1','features','boolean','Contests enabled',NULL,'2026-10-31 07:45:41'),
(24,'leaderboard_enabled','1','features','boolean','Leaderboard enabled',NULL,'2026-10-31 07:45:41'),
(25,'achievements_enabled','0','features','boolean','Achievements enabled',NULL,'2026-10-31 07:45:41'),
(26,'download_login_required','1','content','boolean','Login required to download notes',NULL,'2026-10-31 07:45:41'),
(27,'notes_upload_max_mb','25','content','number','Max note upload size (MB)',NULL,'2026-10-31 07:45:41'),
(28,'allowed_note_extensions','pdf,doc,docx,ppt,pptx,png,jpg,jpeg,txt,md','content','text','Allowed note file types',NULL,'2026-10-31 07:45:41'),
(29,'maintenance_mode','0','system','boolean','Maintenance mode',NULL,'2026-10-31 07:45:41'),
(30,'maintenance_message','SmartODL is under maintenance. Please check back shortly.','system','textarea','Maintenance message',NULL,'2026-10-31 07:45:41'),
(34,'items_per_page','12','system','number','Items per page',NULL,'2026-10-31 07:45:41'),
(35,'enable_global_search','1','features','boolean','Enable global search',NULL,'2026-10-31 07:45:41'),
(36,'default_points_per_problem','10','features','number','Default points per coding problem',NULL,'2026-10-31 07:45:41'),
(37,'tab_guard_enabled','1','anti_cheat','boolean','Detect tab switches in live quizzes',NULL,'2026-10-31 07:45:41'),
(38,'tab_guard_max_violations','3','anti_cheat','number','Maximum tab switches',NULL,'2026-10-31 07:45:41'),
(39,'tab_guard_auto_submit','1','anti_cheat','boolean','Auto-submit after maximum violations',NULL,'2026-10-31 07:45:41'),
(40,'coding_arena_cp_block','1','anti_cheat','boolean','Block copy-paste in Coding Arena',NULL,'2026-10-31 07:45:41'),
(41,'screenshot_block_enabled','1','anti_cheat','boolean','Block screenshot keys in assessments and arena',NULL,'2026-10-31 07:45:41'),
(42,'ai_classifier_arena_enabled','1','anti_cheat','boolean','AI detection - Coding Arena',NULL,'2026-10-31 07:45:41'),
(43,'quiz_lockdown_enabled','1','anti_cheat','boolean','Fullscreen lockdown for live quizzes',NULL,'2026-10-31 07:45:41'),
(44,'exam_safe_mode','1','anti_cheat','boolean','Safe Exam Mode for live quizzes',NULL,'2026-10-31 07:45:41'),
(67,'landing_banner_enabled','1','landing','boolean','Show landing banner',NULL,'2026-10-31 07:45:41'),
(68,'landing_banner_image','/banners/smartodl-default-banner.jpg','landing','file','Banner image',NULL,'2026-10-31 07:45:41'),
(69,'landing_banner_title','Learn with direction. Build with confidence.','landing','text','Banner title',NULL,'2026-10-31 07:45:41'),
(70,'landing_banner_subtitle','Guided courses, coding practice and live assessments in one connected learning environment.','landing','textarea','Banner subtitle',NULL,'2026-10-31 07:45:41'),
(71,'landing_banner_cta_label','Explore courses','landing','text','Button label',NULL,'2026-10-31 07:45:41'),
(72,'landing_banner_cta_link','/courses','landing','text','Button link',NULL,'2026-10-31 07:45:41'),
(73,'ai_classifier_quiz_enabled','1','anti_cheat','boolean','AI detection - Live Quiz',NULL,'2026-10-31 07:45:41'),
(74,'quiz_cp_block','1','anti_cheat','boolean','Live Quiz copy-paste block',NULL,'2026-10-31 07:45:41'),
(75,'upi_enabled','0','payments','boolean','Accept UPI payments (no gateway needed)',NULL,'2026-10-31 07:45:41'),
(76,'upi_vpa','','payments','text','Institution UPI ID / VPA (e.g. college@okicici)',NULL,'2026-10-31 07:45:41'),
(77,'upi_payee_name','','payments','text','Payee name shown in the UPI app',NULL,'2026-10-31 07:45:41'),
(78,'upi_auto_approve','0','payments','boolean','⚠️ Auto-activate on UTR submit — NO bank check. Keep OFF unless you reconcile statements separately',NULL,'2026-10-31 07:45:41'),
(79,'upi_require_utr','1','payments','boolean','Require the 12-digit UTR / reference number',NULL,'2026-10-31 07:45:41'),
(80,'upi_instructions','Scan the QR with any UPI app, pay the exact amount, then enter the 12-digit UTR from your payment receipt.','payments','textarea','Instructions shown on the payment screen',NULL,'2026-10-31 07:45:41'),
(81,'paytm_enabled','0','payments','boolean','Accept Paytm Business payments',NULL,'2026-10-31 07:45:41'),
(82,'paytm_mid','','payments','text','Paytm MID (merchant ID from the dashboard)',NULL,'2026-10-31 07:45:41'),
(83,'paytm_merchant_key','','payments','text','Paytm Merchant Key (keep secret)',NULL,'2026-10-31 07:45:41'),
(84,'paytm_website','DEFAULT','payments','text','Paytm WEBSITE value (WEBSTAGING for test)',NULL,'2026-10-31 07:45:41'),
(85,'paytm_env','test','payments','text','Paytm environment: test or live',NULL,'2026-10-31 07:45:41'),
(86,'razorpay_enabled','0','payments','boolean','Accept Razorpay payments',NULL,'2026-10-31 07:45:41'),
(87,'razorpay_key_id','','payments','text','Razorpay Key ID (rzp_test_… or rzp_live_…)',NULL,'2026-10-31 07:45:41'),
(88,'razorpay_key_secret','','payments','text','Razorpay Key Secret (keep secret)',NULL,'2026-10-31 07:45:41'),
(89,'module_quizzes_enabled','1','features','boolean','Module quizzes (course ke andar har module ka quiz) - separate ON/OFF',NULL,'2026-10-31 07:45:41'),
(90,'module_quiz_anticheat_enabled','1','anti_cheat','boolean','Module quiz anti-cheat floor (tab guard + fullscreen + copy-paste + screenshot block; NO webcam, NO screen share)',NULL,'2026-10-31 07:45:41'),
(91,'proctor_camera_enabled','0','anti_cheat','boolean','Proctoring - webcam presence check (live quiz)',NULL,'2026-10-31 08:03:03'),
(92,'proctor_screen_enabled','0','anti_cheat','boolean','Proctoring - require full screen share (live quiz)',NULL,'2026-10-31 07:45:41'),
(93,'proctor_max_violations','0','anti_cheat','number','Proctoring - auto-submit after this many violations (0 = never)',NULL,'2026-10-31 07:45:41'),
(94,'proctor_advanced_enabled','0','anti_cheat','boolean','Advanced proctoring master switch',NULL,'2026-10-31 07:45:41'),
(95,'proctor_body_detection_enabled','0','anti_cheat','boolean','Advanced proctoring - body and person detection',NULL,'2026-10-31 07:45:41'),
(96,'proctor_head_pose_enabled','0','anti_cheat','boolean','Advanced proctoring - head pose and looking-away detection',NULL,'2026-10-31 07:45:41'),
(97,'proctor_live_snapshot_enabled','0','anti_cheat','boolean','Advanced proctoring - live snapshot grid',NULL,'2026-10-31 07:45:41'),
(98,'proctor_live_webrtc_enabled','0','anti_cheat','boolean','Advanced proctoring - live WebRTC camera and screen view',NULL,'2026-10-31 07:45:41'),
(99,'proctor_second_camera_enabled','0','anti_cheat','boolean','Advanced proctoring - mobile second camera',NULL,'2026-10-31 07:45:41'),
(100,'proctor_room_scan_enabled','0','anti_cheat','boolean','Advanced proctoring - pre-exam room scan',NULL,'2026-10-31 07:45:41'),
(101,'proctor_identity_check_enabled','0','anti_cheat','boolean','Advanced proctoring - face and ID identity check',NULL,'2026-10-31 07:45:41'),
(102,'proctor_mic_monitoring_enabled','0','anti_cheat','boolean','Advanced proctoring - microphone voice activity monitoring',NULL,'2026-10-31 07:45:41'),
(103,'proctor_dual_monitor_enabled','0','anti_cheat','boolean','Advanced proctoring - multiple display detection',NULL,'2026-10-31 07:45:41'),
(104,'proctor_live_warnings_enabled','0','anti_cheat','boolean','Advanced proctoring - host live warnings',NULL,'2026-10-31 07:45:41'),
(105,'proctor_recording_enabled','0','anti_cheat','boolean','Advanced proctoring - consent-based manual recording',NULL,'2026-10-31 07:45:41'),
(106,'proctor_recording_retention_days','30','anti_cheat','number','Proctor recordings - retention in days',NULL,'2026-10-31 07:45:41'),
(107,'integrity_score_enabled','1','anti_cheat','boolean','Integrity score - admin-only review score master switch',NULL,'2026-10-31 07:45:41'),
(108,'integrity_score_tab_switch_penalty','5','anti_cheat','number','Integrity score - points deducted per tab switch',NULL,'2026-10-31 07:45:41'),
(109,'integrity_score_proctor_violation_penalty','10','anti_cheat','number','Integrity score - points deducted per proctor violation',NULL,'2026-10-31 07:45:41'),
(110,'certificate_integrity_band_enabled','1','anti_cheat','boolean','Certificates - show green/yellow/red integrity review band',NULL,'2026-10-31 07:45:41'),
(111,'certificate_integrity_band_public','0','anti_cheat','boolean','Certificates - also show the integrity band on public verification pages',NULL,'2026-10-31 07:45:41'),
(112,'certificate_integrity_scope','course','anti_cheat','text','Certificates - integrity band scope (course or overall)',NULL,'2026-10-31 07:45:41'),
(113,'proctor_webrtc_ice_servers','[{\"urls\":\"stun:stun.l.google.com:19302\"},{\"urls\":\"stun:stun1.l.google.com:19302\"}]','anti_cheat','text','Advanced proctoring - WebRTC ICE servers (JSON)',NULL,'2026-10-31 07:45:41'),
(114,'points_coding_multiplier','2','points','number','Coding score multiplier',NULL,'2026-10-31 07:45:41'),
(115,'points_quiz_multiplier','3','points','number','Quiz mark multiplier',NULL,'2026-10-31 07:45:41'),
(116,'points_course_completed','50','points','number','Course completion bonus',NULL,'2026-10-31 07:45:41'),
(117,'points_perfect_quiz_bonus','10','points','number','Perfect quiz bonus',NULL,'2026-10-31 07:45:41'),
(118,'razorpay_webhook_secret','','payments','text','Razorpay Webhook Secret — set the same value on the /api/subscriptions/razorpay/webhook endpoint in the Razorpay dashboard',NULL,'2026-10-31 07:45:41'),
(119,'lesson_min_open_seconds','15','features','number','Seconds a lesson must stay open before it can be marked complete (0 disables)',NULL,'2026-10-31 07:45:41'),
(120,'normal_quiz_supervision_enabled','1','anti_cheat','boolean','Normal + practice quiz supervision (tab guard, lockdown, copy-paste + screenshot block, Safe Exam Mode)',1,'2026-10-31 08:03:03'),
(121,'normal_quiz_proctoring_enabled','0','anti_cheat','boolean','Allow webcam/screen proctoring on normal + practice quizzes (OFF by default — needs student consent)',1,'2026-10-31 08:03:03');
/*!40000 ALTER TABLE `settings` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `site_pages`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `site_pages` WRITE;
/*!40000 ALTER TABLE `site_pages` DISABLE KEYS */;
INSERT INTO `site_pages` VALUES
(1,'faq','Frequently asked questions','Help centre','Quick answers about courses, quizzes, the coding arena, certificates and billing on {{site_name}}.','faq','[{\"category\":\"Getting started\",\"items\":[{\"q\":\"How do I create an account?\",\"a\":\"Choose Create Account from the top navigation, enter your name, email and a password, then verify your email address. If your college issued you a sign-in link or a Google account, use that instead so your enrolments are mapped automatically.\"},{\"q\":\"I did not receive the verification or reset email.\",\"a\":\"Check your spam and promotions folders first. Mails are sent from the address configured by your administrator, so add it to your contacts. If nothing arrives within a few minutes, request the link again or write to {{contact_email}}.\"},{\"q\":\"Can I use {{site_name}} on a phone?\",\"a\":\"Yes. Courses, notes, quizzes and your dashboard work on any modern mobile browser. The coding arena needs a keyboard for a comfortable experience, so a laptop or desktop is recommended for programming practice and contests.\"},{\"q\":\"How do I change my password or email?\",\"a\":\"Open Settings from your profile menu. You can update your display details and password there. Changing a verified email address may require re-verification.\"}]},{\"category\":\"Courses and study material\",\"items\":[{\"q\":\"How do I enrol in a course?\",\"a\":\"Open the course page and select Enrol. Free courses start immediately. Premium courses require an active subscription or an enrolment granted by your institution.\"},{\"q\":\"Does my progress save automatically?\",\"a\":\"Yes. Lesson completion, quiz attempts and coding submissions are saved to your account as you go, so you can switch devices and continue where you left off.\"},{\"q\":\"Can I download notes for offline study?\",\"a\":\"Notes can be viewed in the browser and printed. Downloadable files are available where the instructor has attached them to a lesson.\"}]},{\"category\":\"Quizzes, exams and integrity\",\"items\":[{\"q\":\"What happens if my internet drops during a quiz?\",\"a\":\"Your answers are saved as you submit each question. Reconnect and reopen the quiz — if time remains on the attempt you can continue. If the attempt has expired, contact your instructor, who can review the attempt log.\"},{\"q\":\"Why did the screen go full-screen and block copy-paste?\",\"a\":\"Instructors can switch on exam integrity controls for an assessment. Depending on the settings these may include full-screen lockdown, blocked copy and paste, tab-switch monitoring and automated review of pasted or AI-generated text. The restrictions apply only while an attempt is in progress.\"},{\"q\":\"What counts as a violation?\",\"a\":\"Leaving the exam tab, exiting full-screen, attempting to copy question content or submitting work that is not your own may be recorded. Repeated violations can auto-submit an attempt. See our Code of Conduct for the full policy.\"},{\"q\":\"Can I retake a quiz?\",\"a\":\"That depends on how the instructor configured the quiz. The number of permitted attempts is shown on the quiz page before you begin.\"}]},{\"category\":\"Coding arena and contests\",\"items\":[{\"q\":\"Which programming languages are supported?\",\"a\":\"The languages enabled by your administrator are listed in the editor’s language selector on every problem. Your solution is compiled and run against the problem’s test cases in an isolated sandbox.\"},{\"q\":\"My solution passed the samples but failed on submit. Why?\",\"a\":\"Sample cases are only a subset. Submissions run against the full hidden test set, which includes edge cases and larger inputs, and must finish inside the problem’s time and memory limits.\"},{\"q\":\"How is the contest leaderboard ranked?\",\"a\":\"Participants are ordered by score first, then by the time taken, then by who started earlier. Attempts still in progress are listed after completed ones.\"}]},{\"category\":\"Certificates\",\"items\":[{\"q\":\"When do I get a certificate?\",\"a\":\"Certificates are issued automatically when you meet the configured requirement — completing every lesson in a course, passing a quiz at the required score, placing in a contest, or reaching a coding milestone.\"},{\"q\":\"How can an employer verify my certificate?\",\"a\":\"Every certificate carries a unique certificate number and a public verification link. Anyone can open that link, or search the number on the Verify Certificate page, to confirm the credential without signing in.\"},{\"q\":\"Can I download my certificate as a PDF?\",\"a\":\"Yes. Open the certificate and choose Print / Download PDF, then save it as a PDF from your browser’s print dialog.\"}]},{\"category\":\"Payments, plans and refunds\",\"items\":[{\"q\":\"What do I get with a paid plan?\",\"a\":\"Paid plans unlock premium courses, premium quizzes and premium coding problems, along with any additional benefits listed on the Pricing page for that plan.\"},{\"q\":\"Which payment methods are accepted?\",\"a\":\"Payments are processed by our payment gateway and support the methods it offers, typically UPI, debit and credit cards, net banking and wallets. {{site_name}} never stores your full card details.\"},{\"q\":\"How do I cancel, and will I be refunded?\",\"a\":\"You can cancel from the Subscription page at any time; access continues until the end of the paid period. Refund eligibility is set out in full on our Refund and Cancellation Policy page.\"},{\"q\":\"I was charged but my plan is not active.\",\"a\":\"Gateway confirmations occasionally arrive late. Refresh the Subscription page after a few minutes. If it is still inactive, write to {{contact_email}} with the payment reference and we will reconcile it.\"}]},{\"category\":\"Account, data and support\",\"items\":[{\"q\":\"How do I delete my account?\",\"a\":\"Write to {{contact_email}} from your registered email address. Some records tied to issued credentials or institutional reporting may be retained as described in our Privacy Policy.\"},{\"q\":\"Who can see my submissions and scores?\",\"a\":\"Your instructors and your institution’s administrators can view your attempts, submissions and progress. Other learners only see what appears on public leaderboards.\"},{\"q\":\"How do I report a bug or a wrong question?\",\"a\":\"Use the Contact page, or write to {{contact_email}} with the page address and a screenshot. Reports about a specific quiz question should also be raised with your instructor.\"}]}]','support',10,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(2,'terms','Terms of use','Platform policy','The rules that apply when you use {{site_name}}.','legal','[{\"heading\":\"Acceptance of these terms\",\"text\":\"By creating an account on {{site_name}} or using any part of the platform you agree to these terms. If you are using the platform through an institution, your institution’s own regulations apply in addition to these terms. If you do not agree, please stop using the platform.\"},{\"heading\":\"Who may use the platform\",\"text\":\"You must provide accurate registration details and keep them current. Accounts are personal and may not be shared, sold or transferred. If you are below the age of majority in your jurisdiction, you may use the platform only with the consent of a parent, guardian or your institution.\"},{\"heading\":\"Your account and security\",\"text\":\"You are responsible for everything done through your account and for keeping your password confidential. Tell us immediately at {{contact_email}} if you believe your account has been accessed without your permission. We may suspend an account where we reasonably suspect compromise or misuse.\"},{\"heading\":\"Acceptable use\",\"text\":\"Use {{site_name}} for lawful learning, assessment and programming activity only. You must not disrupt or overload the service, probe or bypass access controls, scrape content at scale, upload malware, run code intended to escape the execution sandbox, impersonate another person, or harass other users.\"},{\"heading\":\"Academic integrity\",\"text\":\"Work you submit must be your own unless collaboration is expressly permitted. Assessments may apply integrity controls, including full-screen lockdown, copy and paste restrictions, tab-switch monitoring, plagiarism comparison and automated analysis of pasted or AI-generated text. Findings are indicators for human review, not final determinations; your institution decides the outcome under its own policy.\"},{\"heading\":\"Content and intellectual property\",\"text\":\"Courses, notes, questions, problems and platform software remain the property of {{site_name}}, your institution or the respective creators. You receive a personal, non-transferable licence to access the material for your own learning. You may not republish, redistribute or commercially exploit it without written permission.\"},{\"heading\":\"Content you submit\",\"text\":\"You keep ownership of the work you upload, including code and written answers. You grant us the licence needed to store, display, evaluate and back up that work in order to operate the platform and to share it with your instructors and institution.\"},{\"heading\":\"Paid plans\",\"text\":\"Prices, inclusions and durations for paid plans are shown on the Pricing page. Payment, cancellation and refund terms are set out in our Refund and Cancellation Policy, which forms part of these terms.\"},{\"heading\":\"Certificates\",\"text\":\"Certificates confirm that the stated requirement was met on this platform. They are not a degree, diploma or statutory qualification unless your institution separately states otherwise. We may revoke a certificate issued in error or obtained through a breach of academic integrity.\"},{\"heading\":\"Availability and changes\",\"text\":\"We aim to keep the platform available but do not guarantee uninterrupted service. Features may be added, changed or withdrawn, and maintenance may require downtime. We will give reasonable notice of significant changes where we can.\"},{\"heading\":\"Suspension and termination\",\"text\":\"We may suspend or close an account that breaches these terms, puts other users at risk, or is required to be closed by your institution. You may close your account at any time by contacting {{contact_email}}.\"},{\"heading\":\"Limitation of liability\",\"text\":\"The platform is provided on an “as is” basis to the extent permitted by law. We are not liable for indirect or consequential loss, lost opportunity, or loss arising from your failure to keep your credentials secure. Nothing in these terms excludes liability that cannot lawfully be excluded.\"},{\"heading\":\"Changes to these terms\",\"text\":\"We may update these terms. The revision date below always reflects the current version, and continued use after an update means you accept the revised terms.\"},{\"heading\":\"Governing law and contact\",\"text\":\"These terms are governed by the laws of India, and the courts at the location of the operating institution have exclusive jurisdiction unless your institution specifies otherwise. Questions about these terms can be sent to {{contact_email}}.\"}]','legal',20,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(3,'privacy','Privacy policy','Data protection','What {{site_name}} collects, why we collect it, and the control you have over it.','legal','[{\"heading\":\"Scope\",\"text\":\"This policy explains how {{site_name}} handles personal information when you use the platform. Where you access the platform through an institution, that institution is the controller of your academic records and its own privacy notice applies alongside this one.\"},{\"heading\":\"Information you give us\",\"text\":\"Account details such as your name, email address, password hash, and optionally your college, phone number and profile photo. Anything you choose to send us through support channels is also stored with that enquiry.\"},{\"heading\":\"Information created as you learn\",\"text\":\"Enrolments, lesson progress, quiz attempts and answers, coding submissions and test results, contest participation, points, achievements and issued certificates. This is the record your instructors and institution use to assess you.\"},{\"heading\":\"Assessment integrity information\",\"text\":\"When an instructor enables integrity controls, an attempt may record tab-switch and full-screen events, blocked copy or paste actions, timing and typing telemetry, and the output of automated similarity or AI-text analysis. This is used only to support human review of that assessment.\"},{\"heading\":\"Technical information\",\"text\":\"Server logs record IP address, browser and device type, pages requested and timestamps. Cookies and similar storage keep you signed in and remember preferences such as your theme. See our Cookie Policy for the detail.\"},{\"heading\":\"Payment information\",\"text\":\"Subscription payments are processed by our payment gateway. We receive confirmation of the transaction, the plan purchased and a reference identifier. We do not receive or store your full card number, CVV or UPI credentials.\"},{\"heading\":\"How we use information\",\"text\":\"To create and secure your account, deliver courses and assessments, evaluate and grade your work, protect the integrity of exams, issue and verify certificates, process payments, provide support, meet institutional reporting obligations, and improve the platform.\"},{\"heading\":\"Legal bases\",\"text\":\"We process information to perform our contract with you, to meet our legal obligations, with your consent where consent is required, and in our legitimate interests in operating a secure and reliable learning platform.\"},{\"heading\":\"Who we share it with\",\"text\":\"Your instructors and your institution’s administrators. Service providers who host the platform, deliver email, execute code in a sandbox, and process payments, each bound to act only on our instructions. Authorities where disclosure is legally required. We do not sell your personal information or share it for third-party advertising.\"},{\"heading\":\"What is public\",\"text\":\"Leaderboards may display your name, avatar and score. A certificate you have been issued can be confirmed by anyone holding its verification link or certificate number. Nothing else is public by default.\"},{\"heading\":\"Retention\",\"text\":\"Account and learning records are kept while your account is active and for as long as your institution requires them for academic and audit purposes. Certificate records are retained so that credentials stay verifiable. Technical logs are kept for a short operational period and then deleted or anonymised.\"},{\"heading\":\"Security\",\"text\":\"Passwords are stored only as salted hashes. Access to administrative functions is permission-controlled, transport is encrypted in transit, and submitted code is executed in an isolated sandbox. No system is perfectly secure, so please use a strong, unique password.\"},{\"heading\":\"Your rights\",\"text\":\"You can access and correct most details from Settings. You may also request a copy of your data, correction, deletion, or restriction of processing by writing to {{contact_email}} from your registered address. Some records linked to issued credentials or institutional reporting may be retained where we are required to keep them.\"},{\"heading\":\"Children\",\"text\":\"The platform is intended for learners in higher and senior-secondary education. Where it is used by minors, it is provided through an institution that has obtained the necessary parental or guardian consent.\"},{\"heading\":\"Changes and contact\",\"text\":\"We will update this policy as the platform evolves and will revise the date below when we do. For any privacy question or request, write to {{contact_email}}.\"}]','legal',30,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(4,'refund','Refund and cancellation policy','Billing','How subscription cancellations and refunds work on {{site_name}}.','legal','[{\"heading\":\"Scope\",\"text\":\"This policy covers subscription plans bought directly on {{site_name}}. Fees paid to an institution through its own admission or examination process are governed by that institution’s refund rules, not this page.\"},{\"heading\":\"Cancelling a subscription\",\"text\":\"You can cancel at any time from the Subscription page in your account. Cancellation stops the next renewal; it does not end the period you have already paid for. Your premium access continues until the end of that period, after which the account reverts to the free tier.\"},{\"heading\":\"Cooling-off refund\",\"text\":\"If you cancel within 7 days of a first-time purchase and have consumed only a small part of the plan, you may request a full refund. Substantial consumption — for example completing a significant share of a premium course, or being issued a certificate — means the plan has been delivered and the cooling-off refund no longer applies.\"},{\"heading\":\"Renewals\",\"text\":\"Renewal charges are not automatically refundable. If a renewal was taken in error and you have not used the service in the new period, write to us within 7 days of the charge and we will review it.\"},{\"heading\":\"Duplicate and failed payments\",\"text\":\"A duplicate charge for the same plan is refunded in full. If money left your account but the plan did not activate, send the payment reference to {{contact_email}}; we will reconcile it and either activate the plan or refund it.\"},{\"heading\":\"Service failure\",\"text\":\"If a paid feature is unavailable for a prolonged period because of a fault on our side and we cannot restore it, we will extend your plan for the lost time or issue a pro-rata refund, whichever you prefer.\"},{\"heading\":\"What is not refundable\",\"text\":\"Plans cancelled after substantial use, periods already elapsed, accounts suspended for a breach of these terms or of academic integrity, and promotional or free-trial access that carried no charge.\"},{\"heading\":\"How to request a refund\",\"text\":\"Write to {{contact_email}} from your registered email address with the payment reference, the plan name and the reason for the request. We acknowledge requests within 3 working days.\"},{\"heading\":\"How refunds are paid\",\"text\":\"Approved refunds are returned to the original payment method through our payment gateway. Gateway and bank processing usually completes within 5 to 10 working days; the exact timing is set by your bank. Refunds are not paid in cash or to a different account.\"},{\"heading\":\"Disputes\",\"text\":\"If you are unhappy with a refund decision, reply to the same email thread and ask for it to be escalated. Please raise the matter with us before initiating a chargeback so that we have the chance to resolve it.\"}]','legal',40,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(5,'cookies','Cookie policy','Data protection','The cookies and browser storage {{site_name}} uses, and why.','legal','[{\"heading\":\"What cookies are\",\"text\":\"Cookies and similar browser storage are small pieces of data a site keeps on your device so it can recognise you between requests. {{site_name}} uses them sparingly and only for the purposes described here.\"},{\"heading\":\"Strictly necessary\",\"text\":\"These keep you signed in, carry your session and access token, protect forms against cross-site request forgery, and apply rate limiting. The platform cannot work without them, so they are not optional.\"},{\"heading\":\"Preferences\",\"text\":\"These remember choices such as light or dark theme, your preferred programming language in the editor, and layout settings like split-pane widths. Clearing them simply returns the platform to its defaults.\"},{\"heading\":\"Assessment integrity\",\"text\":\"During an exam with integrity controls enabled, short-lived storage records attempt state and violation counters so that a reload does not wipe your progress or reset the counters. This storage is cleared when the attempt finishes.\"},{\"heading\":\"Analytics and advertising\",\"text\":\"We do not use advertising cookies and we do not share browsing data with advertising networks. If your institution enables an analytics tool, it will be named here before it is switched on.\"},{\"heading\":\"Managing cookies\",\"text\":\"You can clear or block cookies in your browser settings. Blocking strictly necessary cookies will sign you out and prevent assessments from running correctly. Preference storage can be cleared at any time without losing your account data.\"},{\"heading\":\"Questions\",\"text\":\"For anything about cookies or browser storage on this platform, write to {{contact_email}}.\"}]','legal',50,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(6,'code-of-conduct','Code of conduct and academic integrity','Community standards','What we expect from every learner, instructor and administrator on {{site_name}}.','legal','[{\"heading\":\"Our standard\",\"text\":\"Everyone on {{site_name}} is entitled to a respectful, safe and fair learning environment. This code applies to coursework, assessments, contests, discussion and any contact you have with other users or staff through the platform.\"},{\"heading\":\"Respectful conduct\",\"text\":\"Treat others courteously. Harassment, discrimination, threats, hate speech, doxxing and deliberately disruptive behaviour are not tolerated, in any language and in any part of the platform.\"},{\"heading\":\"Honest work\",\"text\":\"Submit only work you produced yourself, unless the instructor has expressly allowed collaboration. Do not copy another learner’s answers, buy or sell solutions, use an unauthorised AI assistant where it is prohibited, or present generated text or code as your own.\"},{\"heading\":\"Assessment conduct\",\"text\":\"During an assessment, do not switch to other applications or tabs, leave full-screen, use a second device, photograph or screenshot questions, communicate with anyone, or attempt to disable the integrity controls.\"},{\"heading\":\"Platform integrity\",\"text\":\"Do not share accounts or credentials, attempt to access another user’s data, bypass permission checks, interfere with the code execution sandbox, or publish question banks and problem sets outside the platform.\"},{\"heading\":\"How concerns are reviewed\",\"text\":\"Automated signals such as similarity scores, AI-text indicators and violation counts flag an attempt for human review. They are never the sole basis for a decision. An instructor or administrator examines the attempt in context before any action is taken.\"},{\"heading\":\"Possible outcomes\",\"text\":\"Depending on severity and your institution’s own regulations, outcomes may include a warning, cancellation of an attempt, a mark of zero for the assessment, revocation of a certificate, suspension of platform access, or referral to your institution for disciplinary action.\"},{\"heading\":\"Reporting and appeals\",\"text\":\"Report conduct concerns to your instructor or to {{contact_email}}. If a decision has been taken about your work and you believe it is wrong, you may appeal through your institution’s academic process; the platform will supply the underlying attempt record for that review.\"}]','legal',60,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(7,'disclaimer','Disclaimer','Legal notice','The limits of what {{site_name}} content and credentials represent.','legal','[{\"heading\":\"Educational purpose\",\"text\":\"All courses, notes, questions, problems and solutions on {{site_name}} are provided for education and practice. They are not professional, legal, financial, medical or engineering advice, and should not be relied on as such.\"},{\"heading\":\"Accuracy of content\",\"text\":\"We work to keep material correct and current, but we do not warrant that it is free of errors or omissions, or that it reflects the latest syllabus, standard or language version. If you spot a mistake, please report it so we can correct it.\"},{\"heading\":\"Certificates and outcomes\",\"text\":\"A certificate records that a specific requirement was met on this platform. It is not a degree, diploma or statutory qualification unless your institution expressly states otherwise, and it is not a guarantee of employment, placement, admission or examination success.\"},{\"heading\":\"Automated assessment signals\",\"text\":\"Similarity checks, AI-text analysis and integrity telemetry are probabilistic indicators intended to support human review. They can produce false positives and false negatives, and no decision about a learner should rest on them alone.\"},{\"heading\":\"Code execution\",\"text\":\"Submitted code runs in a sandbox with time and memory limits. Results depend on the test data, limits and language runtime configured for each problem, and may differ from what you observe on your own machine.\"},{\"heading\":\"External links\",\"text\":\"The platform may link to third-party sites and resources. We do not control them and are not responsible for their content, availability or privacy practices.\"},{\"heading\":\"Availability\",\"text\":\"The platform is provided on an “as is” and “as available” basis. We do not warrant uninterrupted or error-free operation, and scheduled maintenance may make features temporarily unavailable.\"}]','legal',70,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40'),
(8,'accessibility','Accessibility statement','Inclusion','How {{site_name}} works towards an interface everyone can use.','legal','[{\"heading\":\"Our commitment\",\"text\":\"{{site_name}} aims to be usable by every learner, including those who rely on assistive technology. We work towards the WCAG 2.1 Level AA guidelines as our reference standard.\"},{\"heading\":\"What is in place\",\"text\":\"Semantic headings and landmark regions, a skip-to-content link, keyboard access to navigation and forms, visible focus outlines, labelled form fields and switches, alternative text on meaningful images, and a light and dark theme with contrast-checked colour tokens.\"},{\"heading\":\"Known limitations\",\"text\":\"The code editor and the certificate print view are visually dense and are best used with a keyboard and a larger screen. Some third-party embedded content may not meet the same standard. Complex data tables are easier to read on a wider viewport.\"},{\"heading\":\"Assessment accommodations\",\"text\":\"Extra time, alternative formats and other reasonable adjustments for an assessment are arranged by your institution. Instructors can configure attempt duration and integrity settings per assessment, so raise accommodation requests with them before the exam.\"},{\"heading\":\"Tell us about a barrier\",\"text\":\"If any part of the platform blocks you, write to {{contact_email}} with the page address, what you were trying to do and the assistive technology you use. We treat accessibility reports as priority defects and will tell you the outcome.\"}]','support',80,1,1,NULL,'2026-10-31 07:45:40','2026-10-31 07:45:40');
/*!40000 ALTER TABLE `site_pages` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `subscription_orders`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `subscription_orders` WRITE;
/*!40000 ALTER TABLE `subscription_orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `subscription_orders` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `subscriptions`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `subscriptions` WRITE;
/*!40000 ALTER TABLE `subscriptions` DISABLE KEYS */;
/*!40000 ALTER TABLE `subscriptions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `user_achievements`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `user_achievements` WRITE;
/*!40000 ALTER TABLE `user_achievements` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_achievements` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `user_anticheat_settings`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `user_anticheat_settings` WRITE;
/*!40000 ALTER TABLE `user_anticheat_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_anticheat_settings` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `user_hint_unlocks`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `user_hint_unlocks` WRITE;
/*!40000 ALTER TABLE `user_hint_unlocks` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_hint_unlocks` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

--
-- Dumping data for table `user_permissions`
--

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `user_permissions` WRITE;
/*!40000 ALTER TABLE `user_permissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `user_permissions` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
--
-- Deletion rules that must hold in the database, not only in the code.
-- A certificate belongs to a student: deleting the account takes its
-- certificates with it (otherwise the public /cert/<token> link keeps showing
-- the name of a deleted person). Deleting a course must NOT delete an already
-- issued certificate — it only clears the link back to the course.
-- Declared here, after every table exists, so import order cannot matter.
--
ALTER TABLE `certificates`
  ADD CONSTRAINT `fk_cert_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_cert_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL;

/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
