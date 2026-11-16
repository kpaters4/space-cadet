# Supplementary check -- does the Sun help when solar conditions actually vary?

Time-ordered, object-grouped walk-forward CV, entirely inside `train` (`--time-cv-folds 6`). Fold *k* trains on chronological blocks before it and scores on the next block; no `valid` or `test` row is ever touched by this check. Candidates only -- the baselines ignore features, so an ablation on them is vacuous.

Run this because the main train/valid split's validation rows sit in a single solar-activity tercile (see `solar_tercile_*` in `error_by_group.csv`), so that split's own sun-vs-no-sun ablation cannot tell "the Sun doesn't help" apart from "this split never tested it." Training spans a real solar range, so each fold boundary below is a genuine before/after in F10.7 -- read the `train_f107_mean` / `valid_f107_mean` columns per fold before trusting any delta.

## classification

| fold | model | feature_set | n_train_objects | n_valid_objects | train_f107_mean | valid_f107_mean | pr_auc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | hist_gb | baseline_no_sun | 534 | 534 | 86.37 | 86.55 | 0.9308 |
| 1 | hist_gb | with_sun_trailing | 534 | 534 | 86.37 | 86.55 | 0.9511 |
| 1 | logistic | baseline_no_sun | 534 | 534 | 86.37 | 86.55 | 0.6918 |
| 1 | logistic | with_sun_trailing | 534 | 534 | 86.37 | 86.55 | 0.6544 |
| 2 | hist_gb | baseline_no_sun | 1068 | 534 | 86.46 | 85.89 | 0.917 |
| 2 | hist_gb | with_sun_trailing | 1068 | 534 | 86.46 | 85.89 | 0.9271 |
| 2 | logistic | baseline_no_sun | 1068 | 534 | 86.46 | 85.89 | 0.7657 |
| 2 | logistic | with_sun_trailing | 1068 | 534 | 86.46 | 85.89 | 0.7464 |
| 3 | hist_gb | baseline_no_sun | 1602 | 534 | 86.26 | 79.51 | 0.8915 |
| 3 | hist_gb | with_sun_trailing | 1602 | 534 | 86.26 | 79.51 | 0.9278 |
| 3 | logistic | baseline_no_sun | 1602 | 534 | 86.26 | 79.51 | 0.6336 |
| 3 | logistic | with_sun_trailing | 1602 | 534 | 86.26 | 79.51 | 0.6253 |
| 4 | hist_gb | baseline_no_sun | 2136 | 533 | 85.07 | 71.03 | 0.9229 |
| 4 | hist_gb | with_sun_trailing | 2136 | 533 | 85.07 | 71.03 | 0.9295 |
| 4 | logistic | baseline_no_sun | 2136 | 533 | 85.07 | 71.03 | 0.7384 |
| 4 | logistic | with_sun_trailing | 2136 | 533 | 85.07 | 71.03 | 0.7397 |
| 5 | hist_gb | baseline_no_sun | 2669 | 533 | 83.72 | 71.48 | 0.9305 |
| 5 | hist_gb | with_sun_trailing | 2669 | 533 | 83.72 | 71.48 | 0.9529 |
| 5 | logistic | baseline_no_sun | 2669 | 533 | 83.72 | 71.48 | 0.8552 |
| 5 | logistic | with_sun_trailing | 2669 | 533 | 83.72 | 71.48 | 0.853 |


**Mean pr_auc across folds, with vs. without sun:**

| model | delta_pr_auc_with_sun_minus_no_sun |
| --- | --- |
| hist_gb | 0.01914 |
| logistic | -0.01318 |


## regression

| fold | model | feature_set | n_train_objects | n_valid_objects | train_f107_mean | valid_f107_mean | mae_log1p_days |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | hist_gb | baseline_no_sun | 307 | 307 | 88.2 | 88.7 | 0.3219 |
| 1 | hist_gb | with_sun_trailing | 307 | 307 | 88.2 | 88.7 | 0.2029 |
| 1 | ridge | baseline_no_sun | 307 | 307 | 88.2 | 88.7 | 0.5911 |
| 1 | ridge | with_sun_trailing | 307 | 307 | 88.2 | 88.7 | 0.5677 |
| 2 | hist_gb | baseline_no_sun | 614 | 307 | 88.45 | 86.43 | 0.269 |
| 2 | hist_gb | with_sun_trailing | 614 | 307 | 88.45 | 86.43 | 0.2043 |
| 2 | ridge | baseline_no_sun | 614 | 307 | 88.45 | 86.43 | 0.791 |
| 2 | ridge | with_sun_trailing | 614 | 307 | 88.45 | 86.43 | 0.7953 |
| 3 | hist_gb | baseline_no_sun | 921 | 306 | 87.87 | 74.05 | 0.3255 |
| 3 | hist_gb | with_sun_trailing | 921 | 306 | 87.87 | 74.05 | 0.1786 |
| 3 | ridge | baseline_no_sun | 921 | 306 | 87.87 | 74.05 | 0.7035 |
| 3 | ridge | with_sun_trailing | 921 | 306 | 87.87 | 74.05 | 0.6976 |
| 4 | hist_gb | baseline_no_sun | 1227 | 306 | 84.96 | 70.39 | 0.3509 |
| 4 | hist_gb | with_sun_trailing | 1227 | 306 | 84.96 | 70.39 | 0.2036 |
| 4 | ridge | baseline_no_sun | 1227 | 306 | 84.96 | 70.39 | 0.6037 |
| 4 | ridge | with_sun_trailing | 1227 | 306 | 84.96 | 70.39 | 0.5486 |
| 5 | hist_gb | baseline_no_sun | 1533 | 306 | 83.68 | 72.61 | 0.53 |
| 5 | hist_gb | with_sun_trailing | 1533 | 306 | 83.68 | 72.61 | 0.3418 |
| 5 | ridge | baseline_no_sun | 1533 | 306 | 83.68 | 72.61 | 1.035 |
| 5 | ridge | with_sun_trailing | 1533 | 306 | 83.68 | 72.61 | 0.8961 |


**Mean mae_log1p_days across folds, with vs. without sun:**

| model | delta_mae_log1p_days_with_sun_minus_no_sun |
| --- | --- |
| hist_gb | -0.1332 |
| ridge | -0.04392 |

