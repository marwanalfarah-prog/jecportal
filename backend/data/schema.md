# JECJordanData.xlsx Schema

- Workbook: `JECJordanData.xlsx`
- Path: `backend/data/JECJordanData.xlsx`
- Sheets documented: 30
- Source: observed directly from the current workbook on 2026-03-29

## Notes

- This document reflects the observed schema currently present in the workbook.
- `Observed dtype` is the pandas dtype inferred when reading the sheet, not a strict database constraint.
- `Non-null` is the count of populated values currently present in that column.
- Some workbook rows are paired with filesystem assets under `backend/data/photos/`.

## Logical Notes

- `persons` is the main entity sheet for registered members.
- `auth_users` also lives in the workbook and stores application login credentials and roles.
- `nationality` stores the nationality value and any related identity/passport fields directly on the same row.
- `mobile_numbers` is keyed by `mobile_number_record_id`, with family relations in `mobile_number_family_relations` and work-job links in `mobile_number_linked_jobs`.
- `emails` is keyed by `email_record_id`, with work-job links in `email_linked_jobs`.
- `schools` is keyed by `school_record_id`, with sections in `school_sections` and attended grades in `school_grades`.
- `person_youth_group` is keyed by `person_youth_group_record_id`, and age-group history now lives in `person_youth_group_age_history`.
- `parishes` stores parish-level metadata and links to parish logo image files by `parish_id`.
- `churches` stores church locations and links each church to a parish through `parish_id`.
- `higher_education.education_state` is the canonical activity/status field for higher education rows.
- `jobs` is keyed by `job_id`, and `employment_state` is the canonical activity/status field.
- `person_titles`, `person_school_system_sectors`, `person_health_conditions`, and `person_special_notes` extend `persons` in separate sheets.
- `youth_group_special_logos` stores special logo metadata, while `school_logos` stores school/university logo metadata. Both point to image files under `backend/data/photos/logos/`.

## Sheets

### `persons`

- Rows: 3156
- Columns: 23

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3156 |
| `ar_first_name` | `object` | 3156 |
| `ar_second_name` | `object` | 3090 |
| `ar_third_name` | `object` | 2951 |
| `ar_last_name` | `object` | 3024 |
| `birth_year` | `float64` | 3142 |
| `gender` | `object` | 3154 |
| `registered` | `bool` | 3156 |
| `birth_day` | `float64` | 3140 |
| `birth_month` | `float64` | 3140 |
| `en_first_name` | `object` | 6 |
| `en_second_name` | `object` | 3 |
| `en_third_name` | `object` | 2 |
| `en_last_name` | `object` | 6 |
| `school_graduated` | `bool` | 3156 |
| `school_system` | `object` | 3156 |
| `mother_ar_first_name` | `object` | 241 |
| `mother_ar_second_name` | `object` | 240 |
| `mother_ar_last_name` | `object` | 240 |
| `mother_en_first_name` | `object` | 1 |
| `mother_en_second_name` | `object` | 1 |
| `mother_en_last_name` | `object` | 1 |
| `school_final_gpa` | `float64` | 1 |

### `nationality`

- Rows: 3154
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3154 |
| `nationality` | `object` | 3154 |

### `mobile_numbers`

- Rows: 3413
- Columns: 6

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3413 |
| `mobile_number_record_id` | `object` | 3413 |
| `mobile_number` | `object` | 3413 |
| `mobile_number_type` | `object` | 3413 |
| `phone_calls_flag` | `bool` | 3413 |
| `whatsapp_flag` | `bool` | 3413 |

### `schools`

- Rows: 2110
- Columns: 6

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 2110 |
| `school_record_id` | `object` | 2110 |
| `school_name` | `object` | 2110 |
| `start_date` | `object` | 5 |
| `end_date` | `object` | 5 |
| `is_current` | `bool` | 2110 |

### `higher_education`

- Rows: 887
- Columns: 8

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 887 |
| `institution_name` | `object` | 883 |
| `major` | `object` | 886 |
| `degree` | `object` | 887 |
| `start_date` | `object` | 1 |
| `end_date` | `object` | 1 |
| `education_state` | `object` | 887 |
| `final_gpa` | `float64` | 1 |

### `jobs`

- Rows: 361
- Columns: 7

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 361 |
| `job_id` | `object` | 361 |
| `job_title` | `object` | 324 |
| `employer_name` | `object` | 326 |
| `start_date` | `object` | 2 |
| `end_date` | `object` | 1 |
| `employment_state` | `object` | 361 |

### `timestamps`

- Rows: 3179
- Columns: 3

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3179 |
| `timestamp` | `object` | 3179 |
| `youth_group_id` | `object` | 3179 |

### `responsibilities`

- Rows: 684
- Columns: 7

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 684 |
| `jec_year` | `float64` | 415 |
| `is_current` | `bool` | 684 |
| `responsibility_name` | `object` | 383 |
| `start_date` | `object` | 0 |
| `end_date` | `object` | 0 |
| `youth_group_id` | `object` | 684 |

### `person_youth_group`

- Rows: 3202
- Columns: 5

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3202 |
| `youth_join_year` | `float64` | 3184 |
| `youth_group_id` | `object` | 3202 |
| `archived` | `bool` | 3202 |
| `person_youth_group_record_id` | `object` | 3202 |

### `person_youth_group_age_history`

- Rows: 3182
- Columns: 4

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_youth_group_record_id` | `object` | 3182 |
| `age_group` | `object` | 3182 |
| `start_date` | `float64` | 0 |
| `end_date` | `float64` | 0 |

### `hobbies_skills`

- Rows: 9438
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 9438 |
| `hobby_skill` | `object` | 9438 |

### `youth_groups`

- Rows: 30
- Columns: 6

| Column | Observed dtype | Non-null |
|---|---|---:|
| `youth_group_id` | `object` | 30 |
| `youth_group_patron` | `object` | 29 |
| `youth_group_short_name` | `object` | 30 |
| `parish_id` | `object` | 29 |
| `use_parish_logo` | `bool` | 30 |
| `inherit_parish_social_media` | `bool` | 30 |

### `auth_users`

- Rows: 3157
- Columns: 4

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `float64` | 3156 |
| `username` | `object` | 3157 |
| `password_hash` | `object` | 3157 |
| `role` | `object` | 3157 |

### `addresses`

- Rows: 3148
- Columns: 8

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3148 |
| `country` | `object` | 3148 |
| `governorate` | `object` | 3148 |
| `city` | `object` | 235 |
| `street_address` | `object` | 154 |
| `lat` | `float64` | 9 |
| `lng` | `float64` | 9 |
| `is_primary` | `bool` | 3148 |

### `nationality_iso_codes`

- Rows: 10
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `nationality_ar` | `object` | 10 |
| `iso_alpha2` | `object` | 10 |

### `emails`

- Rows: 3
- Columns: 4

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3 |
| `email_record_id` | `object` | 3 |
| `email` | `object` | 3 |
| `email_type` | `object` | 3 |

### `personal_email_primary`

- Rows: 3
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `email_record_id` | `object` | 3 |
| `is_primary` | `bool` | 3 |

### `social_media`

- Rows: 3
- Columns: 4

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3 |
| `platform` | `object` | 3 |
| `url` | `object` | 3 |
| `is_primary` | `bool` | 3 |

### `person_titles`

- Rows: 15
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 15 |
| `title` | `object` | 15 |

### `school_grades`

- Rows: 4043
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `school_record_id` | `object` | 4043 |
| `grade` | `object` | 4043 |

### `mobile_number_family_relations`

- Rows: 450
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `mobile_number_record_id` | `object` | 450 |
| `family_relation` | `object` | 450 |

### `mobile_number_linked_jobs`

- Rows: 1
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `mobile_number_record_id` | `object` | 1 |
| `linked_job_ids` | `object` | 1 |

### `school_sections`

- Rows: 2
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `school_record_id` | `object` | 2 |
| `section` | `object` | 2 |

### `email_linked_jobs`

- Rows: 1
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `email_record_id` | `object` | 1 |
| `linked_job_ids` | `object` | 1 |

### `person_school_system_sectors`

- Rows: 1
- Columns: 2

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 1 |
| `school_system_sector` | `object` | 1 |

### `youth_group_special_logos`

- Rows: 2
- Columns: 7

| Column | Observed dtype | Non-null |
|---|---|---:|
| `youth_group_id` | `object` | 2 |
| `special_logo_id` | `object` | 2 |
| `occasion` | `object` | 2 |
| `start_date` | `object` | 2 |
| `end_date` | `float64` | 0 |
| `logo_file_name` | `object` | 2 |
| `is_active` | `bool` | 2 |

### `person_health_conditions`

- Rows: 3
- Columns: 3

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 3 |
| `condition_type` | `object` | 3 |
| `details` | `object` | 3 |

### `person_special_notes`

- Rows: 203
- Columns: 3

| Column | Observed dtype | Non-null |
|---|---|---:|
| `person_id` | `int64` | 203 |
| `note_title` | `object` | 203 |
| `note` | `object` | 203 |

### `school_logos`

- Rows: 11
- Columns: 5
- `school_logo_id` uses typed IDs:
	- `SCLG######` for school logos
	- `UNLG######` for university logos
- Logo files are stored by institution type:
	- school logos in `backend/data/photos/logos/schools/`
	- university logos in `backend/data/photos/logos/universities/`

| Column | Observed dtype | Non-null |
|---|---|---:|
| `school_logo_id` | `object` | 11 |
| `institution_type` | `object` | 11 |
| `institution_name` | `object` | 11 |
| `institution_section` | `float64` | 0 |
| `logo_file_name` | `object` | 11 |

### `parishes`

- Rows: 33
- Columns: 9

| Column | Observed dtype | Non-null |
|---|---|---:|
| `parish_id` | `object` | 33 |
| `patron_saint` | `object` | 33 |
| `area` | `object` | 33 |
| `lpj_url` | `object` | 32 |
| `facebook_url` | `object` | 24 |
| `instagram_url` | `object` | 8 |
| `linkedin_url` | `float64` | 0 |
| `region` | `object` | 33 |
| `governorate` | `object` | 33 |

### `churches`

- Rows: 35
- Columns: 6

| Column | Observed dtype | Non-null |
|---|---|---:|
| `church_id` | `object` | 35 |
| `parish_id` | `object` | 35 |
| `patron_saint` | `object` | 35 |
| `area` | `object` | 35 |
| `lat` | `float64` | 35 |
| `lng` | `float64` | 35 |