# Amexing Dependency Graphs

This directory contains automatically generated dependency graphs for the Amexing Experience platform, created as part of Phase 5 of the regression prevention strategy.

## Generated Files

### Graph Files
- `api-dependencies.*` - API controller dependencies and frontend coupling
- `services-dependencies.*` - External service integration dependencies  
- `config-dependencies.*` - Configuration variable dependency chains
- `features-dependencies.*` - Feature flag impacts and dependencies

### Viewers
- `interactive-viewer.html` - Interactive web-based dependency graph viewer
- `dependency-summary.json` - Comprehensive dependency analysis summary

### Formats Available
- **DOT** (.dot) - Graphviz format for advanced visualization tools
- **Mermaid** (.mermaid) - Mermaid diagram format for documentation
- **JSON** (.json) - Machine-readable dependency data

## Usage

### View Interactive Graphs
Open `interactive-viewer.html` in your web browser for an interactive exploration of all dependency graphs.

### Command Line Usage
```bash
# Generate all graphs in all formats
node scripts/analysis/generate-dependency-graph.js

# Generate specific graph type
node scripts/analysis/generate-dependency-graph.js --type=api

# Generate with risk highlighting
node scripts/analysis/generate-dependency-graph.js --risk-highlight

# Generate interactive viewer only
node scripts/analysis/generate-dependency-graph.js --format=html
```

### Integration with Documentation
These graphs complement the comprehensive documentation in `docs/maps/`:
- API-ENDPOINTS.md
- BUSINESS-FLOWS.md  
- DATABASE-SCHEMA.md
- PERMISSIONS-MATRIX.md
- FRONTEND-BACKEND.md
- EXTERNAL-SERVICES.md
- CONFIGURATION.md
- FEATURE-FLAGS.md

## Updating Graphs

Graphs should be regenerated when:
- New API controllers are added
- External service integrations change
- Configuration dependencies are modified
- Feature flags are added or removed
- System architecture changes significantly

Generated on: 2026-05-06T20:17:07.678Z
