/* eslint-env browser */
/* global bootstrap */
/**
 * Quote Services Catalog - Drag and Drop Manager
 * Manages the offcanvas catalog panel with draggable Experiences, Tours, and Transport items.
 * Items can be dragged onto day cards to quickly add services to the itinerary.
 * Created by Denisse Maldonado
 */

class DragCatalogManager {
  /**
   * @param {ItineraryBuilder} itineraryBuilder - Reference to the global ItineraryBuilder instance
   */
  constructor(itineraryBuilder) {
    this.builder = itineraryBuilder;
    this.offcanvasEl = document.getElementById('catalogOffcanvas');
    this.offcanvas = null;
    this.isOpen = false;
    this.transportServicesCache = [];

    if (!this.offcanvasEl) {
      console.warn('[DragCatalog] Offcanvas element not found');
      return;
    }

    this.offcanvas = new bootstrap.Offcanvas(this.offcanvasEl);
    this.init();
  }

  // =====================
  // INITIALIZATION
  // =====================

  init() {
    this.renderCatalog();
    this.setupSearch();
    this.setupDragEvents();
    this.setupDropTargets();
    this.setupToggleButton();
    this.loadTransportServices();

    // Listen for offcanvas show/hide to toggle button state
    this.offcanvasEl.addEventListener('shown.bs.offcanvas', () => {
      this.isOpen = true;
      const btn = document.getElementById('toggleCatalogBtn');
      if (btn) btn.classList.add('active');
    });

    this.offcanvasEl.addEventListener('hidden.bs.offcanvas', () => {
      this.isOpen = false;
      const btn = document.getElementById('toggleCatalogBtn');
      if (btn) btn.classList.remove('active');
    });

    // Observe #daysContainer for new day cards (auto-refresh drop targets)
    const daysContainer = document.getElementById('daysContainer');
    if (daysContainer) {
      const observer = new MutationObserver(() => this.refreshDropTargetState());
      observer.observe(daysContainer, { childList: true, subtree: true });
    }
  }

  // =====================
  // TOGGLE
  // =====================

  setupToggleButton() {
    const btn = document.getElementById('toggleCatalogBtn');
    if (btn) {
      btn.addEventListener('click', () => this.toggle());
    }
  }

  toggle() {
    if (this.isOpen) {
      this.offcanvas.hide();
    } else {
      this.offcanvas.show();
    }
  }

  show() {
    this.offcanvas.show();
  }

  hide() {
    this.offcanvas.hide();
  }

  // =====================
  // RENDERING
  // =====================

  renderCatalog() {
    this.renderExperiences();
    this.renderTours();
  }

  renderExperiences() {
    const container = document.getElementById('catalogExperiencesList');
    if (!container) return;

    let html = '';
    let count = 0;

    // Regular experiences only (type === 'Experience', from cache array keyed by 'all')
    const experiences = this.builder.experiencesCache.get('all') || [];
    experiences.forEach((exp) => {
      if (!exp.name || exp.active === false || exp.type !== 'Experience') return;
      html += this.renderDraggableItem(exp.id, exp.name, 'experience', 'ti-beach', null);
      count++;
    });

    // Provider experiences — only visible to admin role
    if (window.userRole === 'admin') {
      const providerExps = this.builder.providerExperiencesCache || [];
      providerExps.forEach((exp) => {
        // Skip if no name or provider doesn't exist anymore (resolved pointer must have name)
        if (!exp.name || !exp.provider || !exp.provider.name) return;
        const providerLabel = exp.provider.name;
        html += this.renderDraggableItem(exp.id, exp.name, 'experience', 'ti-beach', providerLabel);
        count++;
      });
    }

    container.innerHTML = html || '<div class="catalog-empty-state">No hay experiencias disponibles</div>';
    this.updateBadge('catalogExpCount', count);
  }

  renderTours() {
    const container = document.getElementById('catalogToursList');
    if (!container) return;

    let html = '';
    let count = 0;

    // Tours (from cache array keyed by 'all')
    const tours = this.builder.toursCache.get('all') || [];
    tours.forEach((tour) => {
      const name = tour.destinationPOI?.name || tour.name || '';
      // Skip inactive, non-existing, or unnamed tours
      if (!name || tour.active === false) return;
      const subLabel = tour.isWalkingTour ? 'Walking' : null;
      html += this.renderDraggableItem(tour.id, name, 'tour', 'ti-map-2', subLabel);
      count++;
    });

    container.innerHTML = html || '<div class="catalog-empty-state">No hay tours disponibles</div>';
    this.updateBadge('catalogToursCount', count);
  }

  renderTransportServices() {
    const container = document.getElementById('catalogTransportList');
    if (!container) return;

    const services = this.transportServicesCache;
    if (!services || services.length === 0) {
      container.innerHTML = '<div class="catalog-empty-state">No hay servicios de transporte disponibles</div>';
      this.updateBadge('catalogTransportCount', 0);
      return;
    }

    // Deduplicate by origin→destination (rate field is legacy/unused)
    const routeMap = new Map();
    services.forEach((service) => {
      if (!service.destination || service.destination === '-') return;
      const routeKey = `${service.origin || ''}→${service.destination}`;
      if (!routeMap.has(routeKey)) routeMap.set(routeKey, service);
    });
    const uniqueRoutes = Array.from(routeMap.values());

    // Group by service type
    const groups = {
      aeropuerto: { label: 'Aeropuerto', icon: 'ti-plane', items: [] },
      'punto-a-punto': { label: 'Punto a Punto', icon: 'ti-arrows-exchange', items: [] },
      local: { label: 'Local', icon: 'ti-map-pin', items: [] },
    };

    uniqueRoutes.forEach((service) => {
      const originType = (service.originServiceType || '').toLowerCase();
      const destType = (service.destinationServiceType || '').toLowerCase();

      // Skip services where both POIs lack a transport-related serviceType
      if (!originType && !destType) return;

      if (originType.includes('aeropuerto') || destType.includes('aeropuerto')) {
        // For aeropuerto/punto-a-punto, require a valid origin
        if (!service.origin || service.origin === 'Sin origen') return;
        groups.aeropuerto.items.push(service);
      } else if (originType.includes('punto') || destType.includes('punto') || originType.includes('point') || destType.includes('point')) {
        if (!service.origin || service.origin === 'Sin origen') return;
        groups['punto-a-punto'].items.push(service);
      } else if (originType.includes('local') || destType.includes('local')) {
        groups.local.items.push(service);
      }
    });

    let html = '';
    let totalCount = 0;

    Object.entries(groups).forEach(([groupKey, group]) => {
      if (group.items.length === 0) return;

      html += `<div class="catalog-transport-group-header"><i class="ti ${group.icon} me-1"></i>${group.label}</div>`;

      group.items.forEach((service) => {
        html += this.renderTransportItem(service, groupKey === 'local');
        totalCount++;
      });
    });

    container.innerHTML = html || '<div class="catalog-empty-state">No hay servicios de transporte disponibles</div>';
    this.updateBadge('catalogTransportCount', totalCount);
  }

  renderTransportItem(service, isLocal = false) {
    const origin = this.escapeHtml(service.origin || 'Sin origen');
    const destination = this.escapeHtml(service.destination || '-');

    if (isLocal) {
      return `
        <div class="catalog-drag-item" draggable="true" data-catalog-id="${service.value}" data-catalog-type="transport">
          <i class="ti ti-grip-vertical catalog-drag-handle"></i>
          <div class="catalog-transport-info">
            <div class="catalog-transport-route">${destination}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="catalog-drag-item catalog-drag-item-tall" draggable="true" data-catalog-id="${service.value}" data-catalog-type="transport">
        <i class="ti ti-grip-vertical catalog-drag-handle"></i>
        <div class="catalog-transport-info">
          <div class="catalog-transport-origin">${origin}</div>
          <div class="catalog-transport-destination">${destination}</div>
        </div>
      </div>
    `;
  }

  renderDraggableItem(id, name, type, icon, subLabel) {
    const badge = subLabel
      ? `<span class="catalog-drag-badge badge bg-light text-muted">${subLabel}</span>`
      : '';
    return `
      <div class="catalog-drag-item" draggable="true" data-catalog-id="${id}" data-catalog-type="${type}">
        <i class="ti ti-grip-vertical catalog-drag-handle"></i>
        <i class="ti ${icon} catalog-drag-icon"></i>
        <span class="catalog-drag-name">${this.escapeHtml(name)}</span>
        ${badge}
      </div>
    `;
  }

  updateBadge(elementId, count) {
    const badge = document.getElementById(elementId);
    if (badge) badge.textContent = count;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // =====================
  // LOAD TRANSPORT SERVICES
  // =====================

  async loadTransportServices() {
    try {
      const response = await fetch('/api/services/active', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          this.transportServicesCache = result.data;
          this.renderTransportServices();
        }
      }
    } catch (error) {
      console.error('[DragCatalog] Error loading transport services:', error);
      const container = document.getElementById('catalogTransportList');
      if (container) {
        container.innerHTML = '<div class="catalog-empty-state">Error al cargar transportes</div>';
      }
    }
  }

  // =====================
  // SEARCH / FILTER
  // =====================

  setupSearch() {
    const searchInputs = [
      { input: 'catalogSearchExperiences', container: 'catalogExperiencesList' },
      { input: 'catalogSearchTours', container: 'catalogToursList' },
      { input: 'catalogSearchTransport', container: 'catalogTransportList' },
    ];

    searchInputs.forEach(({ input, container }) => {
      const el = document.getElementById(input);
      if (el) {
        el.addEventListener('input', (e) => this.filterItems(e.target.value, container));
      }
    });
  }

  filterItems(query, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const items = container.querySelectorAll('.catalog-drag-item');
    const q = query.toLowerCase().trim();

    items.forEach((item) => {
      const name = (item.querySelector('.catalog-drag-name') || item.querySelector('.catalog-transport-info'))?.textContent.toLowerCase() || '';
      item.style.display = !q || name.includes(q) ? '' : 'none';
    });

    // Also show/hide group headers for transport
    const headers = container.querySelectorAll('.catalog-transport-group-header');
    headers.forEach((header) => {
      // Show header if any sibling items after it are visible
      let nextEl = header.nextElementSibling;
      let hasVisibleItems = false;
      while (nextEl && !nextEl.classList.contains('catalog-transport-group-header')) {
        if (nextEl.classList.contains('catalog-drag-item') && nextEl.style.display !== 'none') {
          hasVisibleItems = true;
          break;
        }
        nextEl = nextEl.nextElementSibling;
      }
      header.style.display = hasVisibleItems || !q ? '' : 'none';
    });
  }

  // =====================
  // DRAG SOURCE EVENTS
  // =====================

  setupDragEvents() {
    const panel = document.getElementById('catalogDragSourcePanel');
    if (!panel) return;

    // Delegated dragstart
    panel.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.catalog-drag-item');
      if (!item) return;

      item.classList.add('dragging');
      document.body.classList.add('catalog-dragging');

      const dragData = JSON.stringify({
        id: item.dataset.catalogId,
        type: item.dataset.catalogType,
      });

      // Use custom MIME type to differentiate from day-reorder drags
      e.dataTransfer.setData('application/x-catalog-item', dragData);
      // Also set text/plain as fallback
      e.dataTransfer.setData('text/plain', dragData);
      e.dataTransfer.effectAllowed = 'copy';

      // Temporarily allow overflow so drag ghost isn't clipped by offcanvas
      this.offcanvasEl.style.overflow = 'visible';
    });

    // Delegated dragend
    panel.addEventListener('dragend', (e) => {
      const item = e.target.closest('.catalog-drag-item');
      if (item) item.classList.remove('dragging');
      document.body.classList.remove('catalog-dragging');
      this.offcanvasEl.style.overflow = '';
      this.clearAllDropFeedback();
    });
  }

  // =====================
  // DROP TARGETS ON DAY CARDS
  // =====================

  setupDropTargets() {
    const daysContainer = document.getElementById('daysContainer');
    if (!daysContainer) return;

    // Delegated dragover
    daysContainer.addEventListener('dragover', (e) => {
      // Only respond to catalog drags
      if (!e.dataTransfer.types.includes('application/x-catalog-item')) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      const dayCard = e.target.closest('.day-card');
      if (!dayCard) return;

      // Add hover feedback to this day card only
      if (!dayCard.classList.contains('catalog-drag-over')) {
        this.clearAllDropFeedback();
        dayCard.classList.add('catalog-drag-over');
        this.showDropLabel(dayCard);
      }
    });

    // Delegated dragleave
    daysContainer.addEventListener('dragleave', (e) => {
      const dayCard = e.target.closest('.day-card');
      if (!dayCard) return;

      // Only clear if actually leaving the day card (not entering a child)
      const related = e.relatedTarget;
      if (related && dayCard.contains(related)) return;

      dayCard.classList.remove('catalog-drag-over');
      this.removeDropLabel(dayCard);
    });

    // Delegated drop
    daysContainer.addEventListener('drop', (e) => {
      // Only handle catalog drops
      const catalogData = e.dataTransfer.getData('application/x-catalog-item');
      if (!catalogData) return;

      e.preventDefault();
      e.stopPropagation();

      this.clearAllDropFeedback();

      const dayCard = e.target.closest('.day-card');
      if (!dayCard) return;

      const dayId = dayCard.dataset.dayId;
      if (!dayId) return;

      try {
        const data = JSON.parse(catalogData);
        if (data.id && data.type) {
          this.handleDrop(dayId, data.id, data.type);
        }
      } catch (err) {
        console.error('[DragCatalog] Drop error:', err);
      }
    });
  }

  refreshDropTargetState() {
    // Called by MutationObserver when days are added/removed
    // No action needed since we use delegated events on #daysContainer
  }

  // =====================
  // DROP VISUAL FEEDBACK
  // =====================

  showDropLabel(dayCard) {
    // Remove any existing label first
    this.removeDropLabel(dayCard);

    const dayTitle = dayCard.querySelector('.day-title')?.textContent || 'este día';
    const label = document.createElement('div');
    label.className = 'catalog-drop-label';
    label.textContent = `Soltar aquí → ${dayTitle}`;
    dayCard.appendChild(label);
  }

  removeDropLabel(dayCard) {
    const existing = dayCard.querySelector('.catalog-drop-label');
    if (existing) existing.remove();
  }

  clearAllDropFeedback() {
    document.querySelectorAll('.day-card.catalog-drag-over').forEach((card) => {
      card.classList.remove('catalog-drag-over');
      this.removeDropLabel(card);
    });
    document.querySelectorAll('.day-card.catalog-drop-available').forEach((card) => {
      card.classList.remove('catalog-drop-available');
    });
  }

  // =====================
  // DROP HANDLING
  // =====================

  handleDrop(dayId, itemId, itemType) {
    // Open the service modal for the target day
    this.builder.openServiceModal(dayId);

    // Wait for modal to render, then pre-select type and item
    setTimeout(() => {
      if (itemType === 'experience') {
        this.preselectExperience(itemId);
      } else if (itemType === 'tour') {
        this.preselectTour(itemId);
      } else if (itemType === 'transport') {
        this.preselectTransport(itemId);
      }
    }, 250);
  }

  preselectExperience(experienceId) {
    // Select the Experience service type radio
    const radio = document.getElementById('typeExperience');
    if (radio) {
      radio.checked = true;
      this.builder.handleServiceTypeChange('experience');
    }

    // Wait for experience fields to render, then select the item
    setTimeout(() => {
      const select = document.getElementById('experienceSelect');
      if (select) {
        select.value = experienceId;
        // Trigger the selection handler
        if (typeof this.builder.handleExperienceSelection === 'function') {
          this.builder.handleExperienceSelection(experienceId);
        }
      }
    }, 100);
  }

  preselectTour(tourId) {
    // Select the Tour service type radio
    const radio = document.getElementById('typeTour');
    if (radio) {
      radio.checked = true;
      this.builder.handleServiceTypeChange('tour');
    }

    // Wait for tour fields to render, then select the item
    setTimeout(() => {
      const select = document.getElementById('tourSelect');
      if (select) {
        select.value = tourId;
        // Trigger the selection handler
        if (typeof this.builder.handleTourSelection === 'function') {
          this.builder.handleTourSelection(tourId);
        }
      }
    }, 100);
  }

  preselectTransport(serviceId) {
    // Select the Transport service type radio
    const radio = document.getElementById('typeTransport');
    if (radio) {
      radio.checked = true;
      this.builder.handleServiceTypeChange('transport');
    }

    // Find the service in cache to determine its transport type
    const service = this.transportServicesCache.find((s) => s.value === serviceId);
    if (!service) return;

    const originType = (service.originServiceType || '').toLowerCase();
    const destType = (service.destinationServiceType || '').toLowerCase();

    // Determine transport type
    let transportType = 'aeropuerto';
    if (originType.includes('punto') || destType.includes('punto') || originType.includes('point') || destType.includes('point')) {
      transportType = 'punto-a-punto';
    } else if (originType.includes('local') || destType.includes('local')) {
      transportType = 'local';
    }

    // Wait for transport fields to render, then select transport type
    setTimeout(() => {
      // Select the transport type radio
      const transportTypeMap = {
        aeropuerto: 'transportAeropuerto',
        'punto-a-punto': 'transportPuntoAPunto',
        local: 'transportLocal',
      };

      const transportRadio = document.getElementById(transportTypeMap[transportType]);
      if (transportRadio) {
        transportRadio.checked = true;
        transportRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // After transport type is selected, try to pre-select origin/destination
      setTimeout(() => {
        this.preselectTransportRoute(service, transportType);
      }, 200);
    }, 100);
  }

  preselectTransportRoute(service, transportType) {
    // The service label usually contains origin → destination info
    // Try to match against available dropdown options
    // This is best-effort since transport forms are complex

    // For aeropuerto type with one-way, try to set direction based on POI
    const originPOI = service.originPOI || null;
    const destPOI = service.destinationPOI || null;

    if (transportType === 'aeropuerto') {
      // Check if origin or destination is the airport
      const originIsAirport = (service.originServiceType || '').toLowerCase().includes('aeropuerto');

      if (originIsAirport) {
        // Airport → Hotel = Llegada
        const dirLlegada = document.getElementById('directionLlegada');
        if (dirLlegada) {
          dirLlegada.checked = true;
          dirLlegada.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        // Hotel → Airport = Salida
        const dirSalida = document.getElementById('directionSalida');
        if (dirSalida) {
          dirSalida.checked = true;
          dirSalida.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }
}

// =====================
// INITIALIZATION
// =====================

// Initialize when itinerary caches are ready
document.addEventListener('itinerary-caches-ready', () => {
  if (window.itineraryBuilder) {
    window.catalogManager = new DragCatalogManager(window.itineraryBuilder);
  }
});
