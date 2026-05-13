# Development Workflow - Quick Reference

## 🚨 **MANDATORY WORKFLOW** - No Exceptions

### **📋 Pre-Development Checklist**
```bash
# Morning Setup (2 minutes)
git pull origin main
yarn install  
yarn test:regression                # Health check
yarn test:watch                     # TDD mode (Terminal 1) 
yarn dev                           # Dev server (Terminal 2)
```

### **🔄 TDD Development Cycle** 
```bash
# For ANY feature or bug fix:

# 🔴 RED: Write failing test FIRST
yarn impact:check <file>           # If modifying existing file
# Write integration test that fails

# 🟢 GREEN: Make test pass
yarn test tests/path/to/test.js    # Implement minimal code

# 🔵 REFACTOR: Improve quality
yarn test:regression               # Quick validation (<10s)
yarn lint:fix                      # Auto-fix issues
```

### **⚡ During Development (Use Frequently)**
```bash
yarn test:regression               # After ANY change (<10s)
yarn impact:check <file>           # Before modifying files
yarn lint:fix                      # Fix code quality
```

### **✅ Before Committing (Required)**
```bash
yarn test                          # All tests must pass
yarn quality:all                   # Complete validation
git commit -m "feat: description"  # Hooks run automatically
```

---

## **❌ FORBIDDEN PRACTICES**

- **NO** implementation without tests first
- **NO** modifying existing files without `yarn impact:check`
- **NO** committing without `yarn test:regression` 
- **NO** bypassing quality validation
- **NO** commits that break the workflow

---

## **🎯 Success Indicators**

✅ You write tests **before** code  
✅ You use `yarn test:regression` constantly  
✅ You check impact before file modifications  
✅ Your commits pass git hooks first try  
✅ You leverage monitoring and analysis tools  

---

## **📚 Full Documentation**

- **Complete Guide**: [DEVELOPMENT-WORKFLOW.md](DEVELOPMENT-WORKFLOW.md)
- **Onboarding**: [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md)
- **System Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Emergency Procedures**: [RUNBOOK.md](RUNBOOK.md)

---

**🔗 Keep this reference handy** - Follow it religiously for regression-free development!

*Last Updated: May 6, 2026*