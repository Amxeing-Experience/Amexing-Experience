# Renderer Synchronization Guide

## Overview

The Renderer Sync System ensures consistency between the main quote services view and the unified renderer used across multiple views (preview, summary, public quotes). This guide explains how to use the synchronization tools to maintain rendering consistency.

## The Problem It Solves

The quote services system has multiple views that display service information:
- **Main Services View** (`/quotes/[id]?section=services`) - The editable master view
- **Preview Modal** - Read-only preview in the itinerary
- **Summary View** - Final quote summary
- **Public Quote View** (`/quotes/[folio]`) - Customer-facing view

Previously, each view had its own rendering logic, leading to:
- Inconsistent display of services across views
- Duplicate code maintenance
- Bugs appearing in one view but not others
- Time wasted updating multiple files for UI changes

## Solution Architecture

```
┌─────────────────────────┐     ┌──────────────────────┐
│  Main Services View     │     │  Unified Renderer    │
│  (Editable Master)      │     │  (Read-only Views)   │
├─────────────────────────┤     ├──────────────────────┤
│ quote-services-v2.js    │     │ services-renderer.js │
│ - Edit/Delete/Duplicate │ ←──→│ - Display only       │
│ - Complex interactions  │     │ - Multiple modes     │
│ - State management      │     │ - Normalized data    │
└─────────────────────────┘     └──────────────────────┘
          ↓                                ↓
   [Sync Tools Keep                 [Used by Preview,
    These Aligned]                   Summary, Public]
```

## Quick Start

### Browser DevTools (Development Mode)

When working on the quote services section in development mode:

```javascript
// Open browser console on /quotes/[id]?section=services

// Check if renderers are synchronized
DevTools.checkRendererSync()

// Show visual side-by-side comparison
DevTools.showVisualComparison()

// Check specific service types
DevTools.checkServiceType('transport')
DevTools.checkServiceType('tour')
DevTools.checkServiceType('experience')

// Generate full report
DevTools.generateSyncReport()
```

### Command Line Tools

```bash
# Check synchronization status
npm run check-sync

# Run interactive sync wizard
npm run sync-renderer

# Generate JSON report
npm run sync-report
```

## When to Use These Tools

### Use `npm run check-sync`:
- Before committing changes to quote services
- After updating `quote-services-v2.js`
- When adding new service types or fields
- As part of your PR checklist

### Use `npm run sync-renderer`:
- When `check-sync` reports differences
- After adding new UI elements to main services
- When updating badge colors or labels
- To selectively apply changes

### Use Browser DevTools:
- During active development
- For quick visual comparisons
- To test specific services
- When debugging display issues

## Common Scenarios

### Scenario 1: Adding a New Badge

If you add a new badge to the main services view:

1. Make your changes in `quote-services-v2.js`
2. Open browser console: `DevTools.checkRendererSync()`
3. If differences found, run: `npm run sync-renderer`
4. Select which changes to apply
5. Test in all views

### Scenario 2: Changing a Label

When updating text labels (e.g., "Horario" → "Schedule"):

1. Update in `quote-services-v2.js`
2. Run: `npm run check-sync`
3. Update `services-renderer-config.js` labels
4. Verify with: `npm run check-sync`

### Scenario 3: Adding a New Service Field

For new data fields:

1. Add field rendering in main services
2. Update `services-renderer.js` to handle the field
3. Update `services-renderer-config.js` normalization
4. Check all views display correctly

## File Structure

```
/public/
├── js/
│   ├── services-renderer.js          # Unified renderer component
│   ├── services-renderer-config.js   # Configuration and normalization
│   └── renderer-dev-tools.js         # Browser DevTools
│
├── dashboards/admin/sections/
│   └── quote-services-v2.js          # Main services view (master)
│
/scripts/
├── renderer-sync-check.js            # Sync checking script
└── renderer-sync-wizard.js           # Interactive sync wizard
```

## Troubleshooting

### "Renderers out of sync" but they look identical

The sync checker uses pattern matching which can have false positives. Check:
1. Are the differences only in icons or internal buttons?
2. Use visual comparison: `DevTools.showVisualComparison()`
3. Focus on user-visible content differences

### Changes not appearing in public view

Ensure the backend controller includes all necessary fields:
1. Check `PublicQuoteController.formatSubconcept()`
2. Verify field names match renderer expectations
3. Use data normalization in `services-renderer-config.js`

### DevTools not available

DevTools only load in development mode:
1. Check `NODE_ENV=development`
2. Verify you're on the services section
3. Check browser console for errors

## Best Practices

### DO:
- ✅ Run sync check before committing
- ✅ Use the unified renderer for new read-only views
- ✅ Update both renderers when adding new features
- ✅ Test changes in all views (main, preview, summary, public)
- ✅ Document new rendering rules in config

### DON'T:
- ❌ Edit unified renderer without checking main services
- ❌ Bypass the sync tools "just this once"
- ❌ Mix editing logic into the unified renderer
- ❌ Forget to test the public quote view

## Advanced Usage

### Custom Service Type Checking

```javascript
// Check all services of a specific type
const report = DevTools.checkServiceType('transport');

// Check services matching custom criteria
window.quoteServices.services.forEach((service, id) => {
    if (service.includeGuide || service.includeGreeter) {
        const mainHTML = DevTools.renderMainView(service);
        const unifiedHTML = DevTools.renderUnifiedView(service);
        // Compare...
    }
});
```

### Automated CI Integration

Add to your CI pipeline:

```yaml
- name: Check Renderer Sync
  run: |
    npm run check-sync
    if [ $? -ne 0 ]; then
      echo "Renderers are out of sync!"
      exit 1
    fi
```

## Architecture Details

### Data Flow

1. **Main Services** → Complex state management, direct DOM manipulation
2. **Unified Renderer** → Stateless, pure transformation of data to HTML
3. **Sync Tools** → Pattern matching and comparison between outputs

### Normalization Layer

The `services-renderer-config.js` handles field variations:
- `time` vs `startTime` vs `selectedSchedule`
- `adults` vs `transportAdults` vs `adultsQuantity`
- Different backend/frontend field names

This ensures the unified renderer works with data from any source.

## Contributing

When modifying the quote services rendering:

1. **Main Services Changes**: Update `quote-services-v2.js` first
2. **Run Sync Check**: Use tools to identify what needs updating
3. **Update Unified Renderer**: Apply changes to maintain consistency
4. **Test All Views**: Verify main, preview, summary, and public views
5. **Document Changes**: Update this guide if adding new patterns

## Related Documentation

- [CONTRIBUTING.md](../CONTRIBUTING.md) - General contribution guidelines
- [DEVELOPER-GUIDE.md](./DEVELOPER-GUIDE.md) - Overall development setup
- [Quote Services Architecture](./ARCHITECTURE.md#quote-services) - System design

---

**Created by Denisse Maldonado**  
*Last Updated: May 2024*