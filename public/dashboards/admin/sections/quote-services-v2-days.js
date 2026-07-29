/* eslint-env browser */
/**
 * quote-services-v2-days.js
 * Gestion de DIAS del itinerario (CRUD, render, operaciones por dia) extraida de
 * quote-services-v2.js como ItineraryBuilder.prototype. DEBE cargarse DESPUES de
 * quote-services-v2.js.
 * Created by Denisse Maldonado
 */

ItineraryBuilder.prototype.updateSaveStatus = function (status) {
    const badges = {
      saved: '<span class="badge bg-success"><i class="ti ti-check me-1"></i>Guardado</span>',
      saving: '<span class="badge bg-warning"><i class="ti ti-loader me-1"></i>Guardando...</span>',
      unsaved: '<span class="badge bg-secondary"><i class="ti ti-edit me-1"></i>Sin guardar</span>',
      error: '<span class="badge bg-danger"><i class="ti ti-alert-circle me-1"></i>Error al guardar</span>',
    };
    const html = badges[status] || badges.saved;

    // Refresca el indicador del pie Y el espejo bajo el panel de totales, para que al modificar solo
    // la propina/total (guardado que puede tardar) el usuario vea el estado sin bajar hasta abajo.
    ['saveStatusIndicator', 'saveStatusIndicatorTotals'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });

    // Update continue button state
    this.updateContinueButton(status);
};

ItineraryBuilder.prototype.updateContinueButton = function (status) {
    const continueBtn = document.getElementById('continueToSummaryBtn');
    const continueText = document.getElementById('continueButtonText');

    if (!continueBtn || !continueText) return;

    // Check if quote is fully saved and ready to continue
    const isReadyToContinue = status === 'saved' && !this.hasUnsavedChanges && !this._saveInProgress;

    if (isReadyToContinue) {
      // Enable button for continuation
      continueBtn.disabled = false;
      continueBtn.className = 'btn btn-primary btn-lg px-4 py-2';
      continueText.textContent = 'Continuar al Resumen';
    } else {
      // Disable button and show appropriate message
      continueBtn.disabled = true;
      continueBtn.className = 'btn btn-secondary btn-lg px-4 py-2';

      if (status === 'saving' || this._saveInProgress) {
        continueText.textContent = 'Guardando cambios...';
      } else if (status === 'error') {
        continueText.textContent = 'Error - Guardar primero';
      } else if (this.hasUnsavedChanges) {
        continueText.textContent = 'Guardar cambios primero';
      } else {
        continueText.textContent = 'Continuar al Resumen';
      }
    }
};

ItineraryBuilder.prototype.openDayModal = function (dayId = null) {
    this.editMode = 'day';
    this.currentDayId = dayId;

    const modal = new bootstrap.Modal(document.getElementById('dayModal'));
    const form = document.getElementById('dayForm');

    // Reset or populate form
    if (dayId && this.days.find((d) => d.id === dayId)) {
      const day = this.days.find((d) => d.id === dayId);
      document.getElementById('dayModalLabel').innerHTML = '<i class="ti ti-pencil me-2"></i>Editar Día';
      document.getElementById('dayTitle').value = day.title || '';
      document.getElementById('dayDate').value = day.date || '';
      document.getElementById('dayDescription').value = day.description || '';
    } else {
      document.getElementById('dayModalLabel').innerHTML = '<i class="ti ti-calendar-plus me-2"></i>Agregar Día';
      form.reset();

      // Calculate the next sequential date
      let nextDate;
      if (this.days.length > 0) {
        // Get the last day's date
        const lastDay = this.days[this.days.length - 1];
        if (lastDay.date) {
          const lastDate = new Date(`${lastDay.date}T00:00:00`);
          nextDate = new Date(lastDate);
          nextDate.setDate(lastDate.getDate() + 1);
        } else {
          // If last day has no date, use today
          nextDate = new Date();
        }
      } else {
        // First day, use today
        nextDate = new Date();
      }

      // Set the date input to the calculated date
      document.getElementById('dayDate').value = nextDate.toISOString().split('T')[0];
    }

    modal.show();
};

ItineraryBuilder.prototype.openAddDayInline = function () {
    const row = document.getElementById('addDayInline');
    if (!row) return;
    row.classList.remove('d-none');
    this.refreshQuickAddDayDate();
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const dateInput = document.getElementById('quickDayDate');
    if (dateInput?._flatpickr) dateInput._flatpickr.altInput?.focus();
    else dateInput?.focus();
};

ItineraryBuilder.prototype.toggleAddDayInline = function () {
    const row = document.getElementById('addDayInline');
    if (row && row.classList.contains('d-none')) {
      this.openAddDayInline();
    } else {
      this.closeAddDayInline();
    }
};

ItineraryBuilder.prototype.refreshQuickAddDayDate = function () {
    const dateInput = document.getElementById('quickDayDate');
    if (dateInput && !dateInput.value) {
      this.setDateValue(dateInput, this.getNextSequentialDate());
    }
};

// ¿Ya existe un día con esta fecha? (excludeId permite ignorar el propio día al editar).
// Se usa para evitar días duplicados al agregar/editar.
ItineraryBuilder.prototype.dayDateExists = function (date, excludeId = null) {
    if (!date) return false;
    return this.days.some((d) => d.date === date && d.id !== excludeId);
};

ItineraryBuilder.prototype.quickAddDay = async function () {
    if (this._addingDay) return; // guard against rapid double-clicks
    this._addingDay = true;

    // Loader en el botón mientras se guarda (saveToBackend tarda un poco).
    const addBtn = document.getElementById('addDayConfirmBtn');
    const addBtnHtml = addBtn ? addBtn.innerHTML : null;
    if (addBtn) {
      addBtn.disabled = true;
      addBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Agregando…';
    }

    const titleInput = document.getElementById('quickDayTitle');
    const dateInput = document.getElementById('quickDayDate');
    const rawTitle = (titleInput?.value || '').trim();
    const date = (dateInput?.value || '').trim() || this.getNextSequentialDate();

    // Evitar días duplicados: no agregar un día con una fecha que ya existe.
    if (this.dayDateExists(date)) {
      this.showAlert('Ya existe un día con esa fecha', 'warning');
      this._addingDay = false;
      if (addBtn) { addBtn.disabled = false; addBtn.innerHTML = addBtnHtml; }
      return;
    }

    const title = rawTitle || `Día ${this.days.length + 1}`;

    const newDay = {
      id: this.generateId('day'),
      number: this.days.length + 1,
      title,
      date,
      description: '',
      services: [],
    };

    try {
      this.days.push(newDay);

      // Sort days by date and reassign numbers (same rule as saveDay)
      this.days.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
      this.days.forEach((d, i) => { d.number = i + 1; });

      // Focus the newly created day (highlights it in the sidebar)
      this.currentDayId = newDay.id;

      await this.saveToBackend();
      this.renderItinerary();

      // Reset the inline row for the next entry
      if (titleInput) titleInput.value = '';
      this.setDateValue(dateInput, this.getNextSequentialDate());
      this.showAlert('Día agregado', 'success');
    } catch (error) {
      // Roll back the optimistic insert if the save failed
      this.days = this.days.filter((d) => d.id !== newDay.id);
      this.days.forEach((d, i) => { d.number = i + 1; });
      this.renderItinerary();
      console.error('Error adding day:', error);
      this.showAlert(`Error al agregar el día: ${error.message}`, 'danger');
    } finally {
      this._addingDay = false;
      if (addBtn) {
        addBtn.disabled = false;
        addBtn.innerHTML = addBtnHtml;
      }
    }
};

ItineraryBuilder.prototype.saveDay = async function () {
    let title = document.getElementById('dayTitle').value.trim();
    const date = document.getElementById('dayDate').value;
    const description = document.getElementById('dayDescription').value.trim();

    // Clear any previous modal alerts
    this.clearModalAlert('dayModalAlert');

    // Evitar días duplicados: bloquear si ya existe otro día con la misma fecha
    // (al editar se excluye el propio día vía currentDayId).
    if (this.dayDateExists(date, this.currentDayId)) {
      this.showModalAlert('dayModalAlert', 'Ya existe un día con esa fecha', 'warning');
      return;
    }

    // Auto-generate title if empty
    if (!title) {
      const dayNumber = this.days.length + 1;
      title = `Día ${dayNumber}`;
    }

    // Get button element and set loading state
    const saveBtn = document.getElementById('saveDayBtn');
    const originalContent = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span>Guardando...';
    }

    try {
      if (this.currentDayId) {
        // Update existing day
        const dayIndex = this.days.findIndex((d) => d.id === this.currentDayId);
        if (dayIndex !== -1) {
          this.days[dayIndex] = {
            ...this.days[dayIndex],
            title,
            date,
            description,
          };
        }
      } else {
        // Add new day
        const newDay = {
          id: this.generateId('day'),
          number: this.days.length + 1,
          title,
          date: date || this.getNextSequentialDate(),
          description,
          services: [],
        };
        this.days.push(newDay);
      }

      // Sort days by date and reassign numbers
      this.days.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });
      this.days.forEach((d, i) => { d.number = i + 1; });

      // Save to backend
      await this.saveToBackend();

      // Update UI
      this.renderItinerary();
      this.closeModal('dayModal');
      this.showAlert('Día guardado exitosamente', 'success');
    } catch (error) {
      console.error('Detailed error saving day:', {
        error: error.message,
        stack: error.stack,
        days: this.days,
        quoteId: this.quoteId,
      });
      this.showModalAlert('dayModalAlert', `Error al guardar el día: ${error.message}`, 'danger');
    } finally {
      // Restore button state
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalContent;
      }
    }
};

ItineraryBuilder.prototype.deleteDay = function (dayId) {
    this.currentDayId = dayId;
    // Limpiar currentServiceId: si quedó set de un borrado/edición previa de servicio,
    // confirmDelete tomaba la rama de "borrar servicio" y el DÍA nunca se eliminaba.
    this.currentServiceId = null;
    const day = this.days.find((d) => d.id === dayId);

    if (!day) return;

    const message = `¿Estás seguro de que deseas eliminar el "${day.title}"? Se eliminarán también todos los servicios asociados.`;
    document.getElementById('deleteConfirmMessage').textContent = message;

    const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
    modal.show();
};

ItineraryBuilder.prototype.findOrCreateDayByDate = function (dateStr) {
    if (!dateStr) return this.currentDayId;

    const existingDay = this.days.find((d) => d.date === dateStr);
    if (existingDay) return existingDay.id;

    // Create new day
    const newDay = {
      id: this.generateId('day'),
      number: this.days.length + 1,
      title: `Día ${this.days.length + 1}`,
      date: dateStr,
      description: '',
      services: [],
    };
    this.days.push(newDay);

    // Re-sort days by date and renumber
    this.days.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    this.days.forEach((d, i) => { d.number = i + 1; });

    return newDay.id;
};

ItineraryBuilder.prototype.moveServiceToDay = function (serviceId, oldDayId, newDayId) {
    if (oldDayId === newDayId) return;

    const oldDay = this.days.find((d) => d.id === oldDayId);
    if (oldDay) {
      oldDay.services = oldDay.services.filter((id) => id !== serviceId);
    }

    const newDay = this.days.find((d) => d.id === newDayId);
    if (newDay && !newDay.services.includes(serviceId)) {
      newDay.services.push(serviceId);
      newDay.services = this.sortAndDeduplicateServices(newDay.services);
    }
};

ItineraryBuilder.prototype.renderDaysSidebar = function () {
    const container = document.getElementById('daysList');
    if (!container) return;

    container.innerHTML = this.days.map((day) => `
            <div class="day-nav-item ${day.id === this.currentDayId ? 'active' : ''}" 
                 data-day-id="${day.id}" 
                 draggable="true">
                <i class="ti ti-grip-vertical text-muted me-2" style="cursor: grab; opacity: 0.6;"></i>
                <span class="day-nav-number">${day.number}</span>
                <div class="flex-grow-1">
                    <div class="fw-semibold">${this.truncateText(day.title, 20)}</div>
                    <small class="text-muted">${day.date ? this.formatDate(day.date) : this.generateDefaultDate(day.number)}</small>
                </div>
            </div>
        `).join('');

    // Add event listeners for day navigation and drag & drop
    this.setupSidebarDragAndDrop(container);
};

ItineraryBuilder.prototype.renderDaysContent = function () {
    // Prevent re-rendering while editing to avoid visual glitches
    if (this._editModalOpen) {
      qsDevLog('⚠️ Skipping renderDaysContent - edit modal is open');
      return;
    }

    const container = document.getElementById('daysContainer');
    if (!container) return;

    // Recalcula los conflictos de horario por día en cada render, para que las banderas
    // nunca queden viejas (p. ej. tras borrar un servicio, o si una mutación en memoria no
    // pasó por un sort). detectScheduleOverlaps limpia y recomputa, y respeta la regla de
    // no marcar transporte ni concepto. En try/catch para que un fallo de la detección
    // (p. ej. un caché aún no inicializado) NUNCA aborte el render de la lista de servicios.
    try {
      this.days.forEach((day) => {
        const dayServices = (day.services || [])
          .map((sid) => ({ service: this.services.get(sid) }))
          .filter((s) => s.service);
        this.detectScheduleOverlaps(dayServices);
      });
    } catch (overlapError) {
      console.warn('⚠️ No se pudo recalcular conflictos de horario antes del render:', overlapError);
    }

    container.innerHTML = this.days.map((day) => this.renderDayCard(day)).join('');

    // Attach event listeners to dynamic elements
    this.attachDayEventListeners();

    // Setup drag and drop for main content
    this.setupContentDragAndDrop(container);
};

ItineraryBuilder.prototype.renderDayCard = function (day) {
    // Ordena por horario (ascendente). No hay reorden manual de servicios, así que el orden
    // siempre es cronológico; ordenar aquí garantiza el orden correcto sin depender de cuándo
    // se haya ordenado day.services por última vez.
    const services = day.services
      .map((sid) => this.services.get(sid))
      .filter(Boolean)
      .sort((a, b) => this.parseTimeForSorting(a.selectedSchedule || a.startTime || '')
        - this.parseTimeForSorting(b.selectedSchedule || b.startTime || ''));
    const dayTotalMXN = services.reduce((sum, service) => {
      if (service.includeInTotal === false) return sum;

      const serviceDisplayPrice = this.getServiceDisplayPrice(service);

      // VALIDATION: Check for pricing consistency issues across service types
      if (service.pricesByType && Math.abs(service.price - serviceDisplayPrice) > 0.01) {
        qsDevLog(`💡 VALIDATION: Service price vs display price difference detected (Day ${day.number}):`, {
          serviceId: service.id,
          serviceType: service.type,
          isWalkingTour: service.isWalkingTour,
          storedPrice: service.price,
          displayPrice: serviceDisplayPrice,
          difference: serviceDisplayPrice - service.price,
          paymentType: document.getElementById('priceTypeSelect')?.value,
          pricesByType: service.pricesByType,
        });
      }

      return sum + serviceDisplayPrice;
    }, 0);
    const dayTotal = dayTotalMXN;

    return `
            <div class="day-card mb-4" data-day-id="${day.id}" id="day-${day.id}" draggable="false">
                <div class="card border-0 shadow-sm">
                    <div class="card-header bg-white border-bottom">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center">
                                <i class="ti ti-grip-vertical text-muted me-2 drag-handle" style="cursor: grab; opacity: 0.6;" title="Arrastrar para reordenar"></i>
                                <div class="day-number-badge me-3">
                                    <span class="badge bg-primary rounded-circle" style="width: 35px; height: 35px; display: flex; align-items: center; justify-content: center; font-size: 1rem;">
                                        ${day.number}
                                    </span>
                                </div>
                                <div>
                                    <h5 class="mb-0 day-title">${day.title}</h5>
                                    <small class="text-muted day-date">${day.date ? this.formatDate(day.date) : this.generateDefaultDate(day.number)}</small>
                                    ${day.description ? `<div class="mt-1"><small class="text-muted day-description"><i class="ti ti-notes me-1"></i>${day.description}</small></div>` : ''}
                                </div>
                            </div>
                            <div class="d-flex gap-2">
                                <button type="button" class="btn btn-sm btn-primary add-service-btn"
                                        data-day-id="${day.id}" title="Agregar servicio">
                                    <i class="ti ti-plus"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-light edit-day-btn"
                                        data-day-id="${day.id}" title="Editar día">
                                    <i class="ti ti-pencil"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-light duplicate-day-btn" 
                                        data-day-id="${day.id}" title="Duplicar día">
                                    <i class="ti ti-copy"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-light delete-day-btn" 
                                        data-day-id="${day.id}" title="Eliminar día">
                                    <i class="ti ti-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="services-list">
                            ${services.map((service) => this.renderServiceItem(service)).join('')}
                        </div>
                        
                        <button type="button" class="btn btn-outline-primary btn-sm w-100 mt-3 add-service-btn"
                                data-day-id="${day.id}">
                            <i class="ti ti-plus me-1"></i>Agregar Servicio
                        </button>
                    </div>
                    <div class="card-footer bg-light">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="text-muted">Total del día:</span>
                            <span class="fw-bold day-total">${this.formatCurrency(dayTotal)}</span>
                        </div>
                        <div class="d-flex justify-content-between align-items-center mt-1">
                            <span class="text-muted d-flex align-items-center gap-1">
                                Total por persona
                                <span class="d-inline-flex align-items-center">
                                    (<input type="number" class="day-person-count-input" value="${this.numberOfPeople || 0}" min="0" style="width: 40px; border: none; border-bottom: 1px dashed #6c757d; background: transparent; text-align: center; padding: 0; font-size: inherit; color: inherit; outline: none;">
)
                                </span>
                            </span>
                            <span class="fw-semibold text-info day-per-person">${this.numberOfPeople > 0 ? this.formatCurrency(dayTotal / this.numberOfPeople) : '$0.00'}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
};

ItineraryBuilder.prototype.generateDefaultDate = function (dayNumber) {
    // Generate a default date starting from today + (day number - 1)
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + (dayNumber - 1));

    return this.capitalizeFirst(targetDate.toLocaleDateString('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }));
};

ItineraryBuilder.prototype.sortServicesByTime = function (serviceIds) {
    if (!serviceIds || serviceIds.length === 0) return [];

    // Get service objects
    const services = serviceIds
      .map((serviceId) => {
        const service = this.services.get(serviceId);
        return service ? { id: serviceId, service } : null;
      })
      .filter((s) => s !== null);

    // Sort by time
    services.sort((a, b) => {
      const timeStrA = a.service.selectedSchedule || a.service.startTime || '';
      const timeStrB = b.service.selectedSchedule || b.service.startTime || '';
      const timeA = this.parseTimeForSorting(timeStrA);
      const timeB = this.parseTimeForSorting(timeStrB);
      return timeA - timeB;
    });

    // Detect overlaps after sorting
    this.detectScheduleOverlaps(services);

    return services.map((s) => s.id);
};

ItineraryBuilder.prototype.recalculateOverlapsForDay = function (day) {
    if (!day || !day.services || day.services.length === 0) return;

    // Get service objects for this day
    const dayServices = day.services
      .map((serviceId) => {
        const service = this.services.get(serviceId);
        return service ? { id: serviceId, service } : null;
      })
      .filter((s) => s !== null);

    // Recalculate overlaps for this day's services
    this.detectScheduleOverlaps(dayServices);

    // qsDevLog('🔄 Recalculated overlaps for day:', day.title, dayServices.map(s => ({
    //     concept: this.getServiceTitle(s.service),
    //     hasOverlap: s.service.hasOverlap
    // })));
};

ItineraryBuilder.prototype.getCurrentDayContext = function () {
    if (!this.currentDayId) {
      return { dayOfWeek: null, dayDate: null, dayInfo: null };
    }

    const dayInfo = this.days.find((d) => d.id === this.currentDayId);
    if (!dayInfo || !dayInfo.date) {
      return { dayOfWeek: null, dayDate: null, dayInfo };
    }

    const dayDate = new Date(dayInfo.date);
    const dayOfWeek = dayDate.getDay();

    return { dayOfWeek, dayDate, dayInfo };
};
