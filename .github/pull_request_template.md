## 📋 Quick Summary
Brief description of changes (1-2 sentences)

## 🔒 Security Check (PCI DSS Required)
- [ ] No hardcoded secrets, passwords, or API keys
- [ ] No cardholder data (PAN) in logs or code comments
- [ ] Security middleware not bypassed or disabled
- [ ] All user inputs validated and sanitized

## 🧪 TDD Compliance
- [ ] Tests written **before** implementation (Red-Green-Refactor)
- [ ] Integration tests use MongoDB Memory Server (not external DB)
- [ ] Integration tests use AuthTestHelper for authentication
- [ ] No deprecated patterns (`clearDatabase()`, manual user creation)
- [ ] Test coverage for new features ≥ 80%

## ✅ Quality Checklist
- [ ] Tests pass (`yarn test`)
- [ ] Linting passes (`yarn lint`)
- [ ] No `console.log()` statements in production code
- [ ] Documentation updated (if applicable)

## 🧪 How was this tested?

**TDD Approach**:
- [ ] ✅ Tests written first (Red phase)
- [ ] ✅ Implementation passed tests (Green phase)
- [ ] ✅ Code refactored maintaining tests (Refactor phase)

**Test Types**:
- [ ] Integration tests (`yarn test:integration`)
- [ ] Unit tests (`yarn test:unit`)
- [ ] Manual testing
- [ ] Security testing (`yarn test:security`)

**Test Commands Run**:
```bash
yarn test:integration  # MongoDB Memory Server tests
yarn test:unit         # Fast unit tests
yarn test:security     # PCI DSS compliance
```

**Test Coverage**: [X]% (minimum 80% for new code)

## 🔄 Type of Change
- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## 🚨 Breaking Changes
**Are there breaking changes?** Yes/No

If yes, describe what breaks and how to migrate:

---
**Note**: This PR will be reviewed according to our security guidelines. Security-sensitive changes require approval from `@security-team`.