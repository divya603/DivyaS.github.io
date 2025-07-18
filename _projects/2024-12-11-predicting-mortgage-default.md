---
title: "Predicting Mortgage Default Using XGBoost for Classification"
collection: projects
category: machine-learning
#permalink: /projects/2024-12-11-predicting-mortgage-default
excerpt: 'This project explores predicting loan defaults using machine learning models like XGBoost and Decision Trees, with significant improvements in recall for defaulted loans.'
date: 2024-12-11
tools: ['Python', 'XGBoost', 'SMOTE', 'GridSearchCV']
repo: 'https://github.com/divya603/mortgage-default-prediction' # Optional GitHub repository link
report: '' # Optional detailed report link
---

This project tackled the challenges of predicting loan defaults using machine learning models. A baseline Decision Tree model was compared to XGBoost for advanced classification, and techniques like GridSearchCV and SMOTE were utilized for optimization and class balancing.

### Highlights:
- Baseline Model (Decision Tree): Achieved 85% accuracy with limited recall for defaulted loans (7%).
- XGBoost Implementation: Improved accuracy to 87% and recall to 27%.
- Undersampling: Boosted recall to 66% for defaulted loans at the expense of reduced accuracy (75%).

### Challenges and Contributions:
- Preprocessed a large, noisy dataset with missing and inconsistent data.
- Developed robust pipelines for hyperparameter tuning and cross-validation.
- Highlighted industry-wide issues in data collection practices, advocating for improvements.

[View Project on GitHub](https://github.com/divya603/mortgage-default-prediction)

