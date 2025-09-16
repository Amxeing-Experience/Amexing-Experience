/**
 * Intelligent OAuth Provider Selector - Sprint 04
 * Smart provider selection based on email domain, corporate context, and user behavior
 * Provides intelligent suggestions and seamless user experience.
 */

class IntelligentProviderSelector {
  constructor(options = {}) {
    this.config = {
      container: options.container || document.getElementById('provider-selector'),
      corporateConfig: options.corporateConfig || null,
      department: options.department || null,
      availableProviders: options.availableProviders || ['google', 'microsoft', 'apple'],
      enableLearning: options.enableLearning !== false,
      showSuggestionReason: options.showSuggestionReason !== false,
      animationDuration: options.animationDuration || 300,
      ...options,
    };

    this.currentSuggestion = null;
    this.userInteractions = [];
    this.domainDatabase = new Map();
    this.learningData = this.loadLearningData();

    this.initialize();
  }

  /**
   * Initialize the intelligent provider selector.
   * @example
   */
  async initialize() {
    if (!this.config.container) {
      console.warn('IntelligentProviderSelector: Container not found');
      return;
    }

    try {
      // Load domain intelligence database
      await this.loadDomainDatabase();

      // Load user learning data
      await this.loadUserLearningData();

      // Setup provider detection
      this.setupProviderDetection();

      // Setup analytics tracking
      this.setupAnalytics();

      // Initialize UI
      this.initializeUI();

      logger.info('IntelligentProviderSelector initialized successfully');
    } catch (error) {
      console.error('Failed to initialize IntelligentProviderSelector:', error);
    }
  }

  /**
   * Load domain intelligence database.
   * @example
   */
  async loadDomainDatabase() {
    try {
      // Load common domain mappings
      const commonDomains = {
        // Google domains
        'gmail.com': { provider: 'google', confidence: 0.95, type: 'consumer' },
        'googlemail.com': { provider: 'google', confidence: 0.95, type: 'consumer' },
        'google.com': { provider: 'google', confidence: 0.99, type: 'corporate' },

        // Microsoft domains
        'outlook.com': { provider: 'microsoft', confidence: 0.95, type: 'consumer' },
        'hotmail.com': { provider: 'microsoft', confidence: 0.95, type: 'consumer' },
        'live.com': { provider: 'microsoft', confidence: 0.95, type: 'consumer' },
        'microsoft.com': { provider: 'microsoft', confidence: 0.99, type: 'corporate' },

        // Apple domains
        'icloud.com': { provider: 'apple', confidence: 0.95, type: 'consumer' },
        'me.com': { provider: 'apple', confidence: 0.95, type: 'consumer' },
        'mac.com': { provider: 'apple', confidence: 0.95, type: 'consumer' },
        'apple.com': { provider: 'apple', confidence: 0.99, type: 'corporate' },

        // Common corporate domains with likely providers
        'accenture.com': { provider: 'microsoft', confidence: 0.8, type: 'corporate' },
        'deloitte.com': { provider: 'microsoft', confidence: 0.8, type: 'corporate' },
        'pwc.com': { provider: 'microsoft', confidence: 0.8, type: 'corporate' },
        'ibm.com': { provider: 'microsoft', confidence: 0.7, type: 'corporate' },
        'amazon.com': { provider: 'google', confidence: 0.6, type: 'corporate' },

        // Educational domains (tend to use Google)
        edu: { provider: 'google', confidence: 0.7, type: 'educational' },
        'ac.uk': { provider: 'google', confidence: 0.7, type: 'educational' },
        uni: { provider: 'google', confidence: 0.6, type: 'educational' },
      };

      // Load from server if available
      try {
        const response = await fetch('/api/oauth/domain-intelligence', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });

        if (response.ok) {
          const serverDomains = await response.json();
          Object.assign(commonDomains, serverDomains.domains || {});
        }
      } catch (error) {
        console.warn('Could not load server domain database:', error);
      }

      // Merge with corporate-specific mappings
      if (this.config.corporateConfig?.domainMappings) {
        Object.entries(this.config.corporateConfig.domainMappings).forEach(([domain, provider]) => {
          commonDomains[domain] = {
            provider,
            confidence: 0.99,
            type: 'corporate_verified',
            corporateId: this.config.corporateConfig.id,
          };
        });
      }

      // Store in domain database
      Object.entries(commonDomains).forEach(([domain, info]) => {
        this.domainDatabase.set(domain, info);
      });
    } catch (error) {
      console.error('Failed to load domain database:', error);
    }
  }

  /**
   * Load user learning data from local storage.
   * @example
   */
  loadUserLearningData() {
    try {
      const stored = localStorage.getItem('oauth_provider_learning');
      if (stored) {
        this.learningData = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Could not load learning data:', error);
      this.learningData = {
        userChoices: {},
        domainPreferences: {},
        successfulProviders: {},
        rejectedSuggestions: {},
      };
    }

    return this.learningData;
  }

  /**
   * Save learning data to local storage.
   * @example
   */
  saveLearningData() {
    if (!this.config.enableLearning) return;

    try {
      localStorage.setItem('oauth_provider_learning', JSON.stringify(this.learningData));
    } catch (error) {
      console.warn('Could not save learning data:', error);
    }
  }

  /**
   * Setup provider detection.
   * @example
   */
  setupProviderDetection() {
    // Email input detection
    const emailInputs = document.querySelectorAll('input[type="email"], input[name="email"], input[name="identifier"]');

    emailInputs.forEach((input) => {
      // Debounce email detection
      let timeout;
      input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          this.analyzeEmailAndSuggest(e.target.value);
        }, 500);
      });

      // Immediate detection on blur
      input.addEventListener('blur', (e) => {
        clearTimeout(timeout);
        this.analyzeEmailAndSuggest(e.target.value);
      });
    });

    // Auto-detection based on page context
    this.detectContextualProvider();
  }

  /**
   * Setup analytics tracking.
   * @example
   */
  setupAnalytics() {
    // Track provider selection events
    document.addEventListener('providerSelected', (e) => {
      this.trackProviderSelection(e.detail);
    });

    // Track suggestion interactions
    document.addEventListener('suggestionInteraction', (e) => {
      this.trackSuggestionInteraction(e.detail);
    });
  }

  /**
   * Initialize UI components.
   * @example
   */
  initializeUI() {
    if (!this.config.container) return;

    // Create provider selector UI
    this.createProviderSelectorUI();

    // Create suggestion display area
    this.createSuggestionDisplay();

    // Create provider buttons
    this.createProviderButtons();

    // Setup interaction handlers
    this.setupUIInteractions();
  }

  /**
   * Create provider selector UI.
   * @example
   */
  createProviderSelectorUI() {
    const { container } = this.config;

    // Create main selector container
    const selectorDiv = document.createElement('div');
    selectorDiv.className = 'intelligent-provider-selector';
    // Build DOM structure to prevent XSS
    const suggestionArea = document.createElement('div');
    suggestionArea.className = 'suggestion-area';
    suggestionArea.style.display = 'none';

    const suggestionContent = document.createElement('div');
    suggestionContent.className = 'suggestion-content';

    const suggestionIcon = document.createElement('div');
    suggestionIcon.className = 'suggestion-icon';
    suggestionIcon.textContent = '💡';

    const suggestionText = document.createElement('div');
    suggestionText.className = 'suggestion-text';

    const suggestionActions = document.createElement('div');
    suggestionActions.className = 'suggestion-actions';

    const suggestionAccept = document.createElement('button');
    suggestionAccept.className = 'suggestion-accept';
    suggestionAccept.type = 'button';
    suggestionAccept.textContent = 'Use this';

    const suggestionDismiss = document.createElement('button');
    suggestionDismiss.className = 'suggestion-dismiss';
    suggestionDismiss.type = 'button';
    suggestionDismiss.textContent = '×';

    suggestionActions.appendChild(suggestionAccept);
    suggestionActions.appendChild(suggestionDismiss);
    suggestionContent.appendChild(suggestionIcon);
    suggestionContent.appendChild(suggestionText);
    suggestionContent.appendChild(suggestionActions);
    suggestionArea.appendChild(suggestionContent);

    const providerGrid = document.createElement('div');
    providerGrid.className = 'provider-grid';

    const providerAlternatives = document.createElement('div');
    providerAlternatives.className = 'provider-alternatives';
    providerAlternatives.style.display = 'none';

    const alternativesText = document.createElement('p');
    alternativesText.className = 'alternatives-text';
    alternativesText.textContent = 'Or choose another option:';

    const alternativesGrid = document.createElement('div');
    alternativesGrid.className = 'alternatives-grid';

    providerAlternatives.appendChild(alternativesText);
    providerAlternatives.appendChild(alternativesGrid);

    selectorDiv.appendChild(suggestionArea);
    selectorDiv.appendChild(providerGrid);
    selectorDiv.appendChild(providerAlternatives);

    container.appendChild(selectorDiv);

    // Store references
    this.elements = {
      selector: selectorDiv,
      suggestionArea: selectorDiv.querySelector('.suggestion-area'),
      suggestionText: selectorDiv.querySelector('.suggestion-text'),
      suggestionAccept: selectorDiv.querySelector('.suggestion-accept'),
      suggestionDismiss: selectorDiv.querySelector('.suggestion-dismiss'),
      providerGrid: selectorDiv.querySelector('.provider-grid'),
      alternatives: selectorDiv.querySelector('.provider-alternatives'),
      alternativesGrid: selectorDiv.querySelector('.alternatives-grid'),
    };
  }

  /**
   * Create suggestion display.
   * @example
   */
  createSuggestionDisplay() {
    // Style the suggestion area
    const style = document.createElement('style');
    style.textContent = `
      .intelligent-provider-selector {
        margin: 1rem 0;
      }
      
      .suggestion-area {
        margin-bottom: 1rem;
        padding: 1rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        color: white;
        animation: suggestionSlideIn 0.3s ease-out;
        position: relative;
        overflow: hidden;
      }
      
      .suggestion-area::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 12px;
      }
      
      .suggestion-content {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      
      .suggestion-icon {
        font-size: 1.5rem;
        flex-shrink: 0;
      }
      
      .suggestion-text {
        flex: 1;
        font-weight: 500;
      }
      
      .suggestion-reason {
        font-size: 0.875rem;
        opacity: 0.9;
        margin-top: 0.25rem;
      }
      
      .suggestion-actions {
        display: flex;
        gap: 0.5rem;
        flex-shrink: 0;
      }
      
      .suggestion-accept {
        padding: 0.5rem 1rem;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 6px;
        color: white;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .suggestion-accept:hover {
        background: rgba(255, 255, 255, 0.3);
        transform: translateY(-1px);
      }
      
      .suggestion-dismiss {
        width: 32px;
        height: 32px;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        transition: all 0.2s ease;
      }
      
      .suggestion-dismiss:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: scale(1.1);
      }
      
      .provider-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }
      
      .provider-button {
        display: flex;
        align-items: center;
        padding: 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 8px;
        background: white;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        color: inherit;
        position: relative;
        overflow: hidden;
      }
      
      .provider-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }
      
      .provider-button.suggested {
        border-color: #667eea;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
      }
      
      .provider-button.suggested::after {
        content: 'Recommended';
        position: absolute;
        top: -1px;
        right: -1px;
        background: #667eea;
        color: white;
        font-size: 0.75rem;
        padding: 0.25rem 0.5rem;
        border-radius: 0 6px 0 8px;
        font-weight: 500;
      }
      
      .provider-icon {
        width: 32px;
        height: 32px;
        margin-right: 1rem;
        flex-shrink: 0;
      }
      
      .provider-info {
        flex: 1;
      }
      
      .provider-name {
        font-weight: 600;
        margin-bottom: 0.25rem;
      }
      
      .provider-description {
        font-size: 0.875rem;
        color: #6b7280;
      }
      
      .confidence-indicator {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        font-weight: bold;
        margin-left: 0.5rem;
      }
      
      .confidence-high {
        background: #10b981;
        color: white;
      }
      
      .confidence-medium {
        background: #f59e0b;
        color: white;
      }
      
      .confidence-low {
        background: #6b7280;
        color: white;
      }
      
      .provider-alternatives {
        border-top: 1px solid #e5e7eb;
        padding-top: 1rem;
      }
      
      .alternatives-text {
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 0.75rem;
        text-align: center;
      }
      
      .alternatives-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 0.5rem;
      }
      
      .alternative-button {
        padding: 0.75rem;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: white;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s ease;
        font-size: 0.875rem;
      }
      
      .alternative-button:hover {
        border-color: #667eea;
        background: rgba(102, 126, 234, 0.05);
      }
      
      @keyframes suggestionSlideIn {
        0% {
          opacity: 0;
          transform: translateY(-10px);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      @media (max-width: 768px) {
        .suggestion-content {
          flex-direction: column;
          align-items: stretch;
          gap: 0.75rem;
        }
        
        .suggestion-actions {
          justify-content: center;
        }
        
        .provider-button {
          padding: 0.875rem;
        }
        
        .alternatives-grid {
          grid-template-columns: 1fr 1fr;
        }
      }
    `;

    if (!document.querySelector('#intelligent-provider-styles')) {
      style.id = 'intelligent-provider-styles';
      document.head.appendChild(style);
    }
  }

  /**
   * Create provider buttons.
   * @example
   */
  createProviderButtons() {
    const providerInfo = {
      google: {
        name: 'Google',
        description: 'Google Workspace, Gmail accounts',
        icon: this.getProviderIcon('google'),
        color: '#db4437',
      },
      microsoft: {
        name: 'Microsoft',
        description: 'Microsoft 365, Outlook accounts',
        icon: this.getProviderIcon('microsoft'),
        color: '#0078d4',
      },
      apple: {
        name: 'Apple',
        description: 'Apple ID, iCloud accounts',
        icon: this.getProviderIcon('apple'),
        color: '#000000',
      },
    };

    this.config.availableProviders.forEach((provider) => {
      if (providerInfo[provider]) {
        const button = this.createProviderButton(provider, providerInfo[provider]);
        this.elements.providerGrid.appendChild(button);
      }
    });

    // Update alternatives if needed
    this.updateAlternativesDisplay();
  }

  /**
   * Create individual provider button.
   * @param provider
   * @param info
   * @example
   */
  createProviderButton(provider, info) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'provider-button';
    button.dataset.provider = provider;

    // Use DOM methods to prevent XSS
    const iconDiv = document.createElement('div');
    iconDiv.className = 'provider-icon';
    iconDiv.innerHTML = info.icon; // Safe: info.icon contains static SVG from trusted source

    const infoDiv = document.createElement('div');
    infoDiv.className = 'provider-info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'provider-name';
    nameDiv.textContent = info.name; // Safe: using textContent

    const descriptionDiv = document.createElement('div');
    descriptionDiv.className = 'provider-description';
    descriptionDiv.textContent = info.description; // Safe: using textContent

    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(descriptionDiv);
    button.appendChild(iconDiv);
    button.appendChild(infoDiv);

    button.addEventListener('click', () => {
      this.selectProvider(provider);
    });

    return button;
  }

  /**
   * Analyze email and suggest provider.
   * @param email
   * @example
   */
  analyzeEmailAndSuggest(email) {
    if (!email || !email.includes('@')) {
      this.hideSuggestion();
      return;
    }

    const domain = email.split('@')[1].toLowerCase();
    const suggestion = this.generateSuggestion(email, domain);

    if (suggestion) {
      this.showSuggestion(suggestion);
    } else {
      this.hideSuggestion();
    }
  }

  /**
   * Generate intelligent suggestion.
   * @param email
   * @param domain
   * @example
   */
  generateSuggestion(email, domain) {
    const analyses = [
      this.analyzeDomainDatabase(domain),
      this.analyzeLearningData(email, domain),
      this.analyzeCorporateContext(domain),
      this.analyzeDepartmentContext(domain),
      this.analyzeCommonPatterns(domain),
    ];

    // Find the highest confidence suggestion
    const bestSuggestion = analyses
      .filter((analysis) => analysis && analysis.provider)
      .sort((a, b) => b.confidence - a.confidence)[0];

    if (bestSuggestion && bestSuggestion.confidence >= 0.6) {
      return {
        provider: bestSuggestion.provider,
        confidence: bestSuggestion.confidence,
        reason: bestSuggestion.reason,
        email,
        domain,
        source: bestSuggestion.source,
      };
    }

    return null;
  }

  /**
   * Analyze domain database.
   * @param domain
   * @example
   */
  analyzeDomainDatabase(domain) {
    const domainInfo = this.domainDatabase.get(domain);
    if (domainInfo) {
      return {
        provider: domainInfo.provider,
        confidence: domainInfo.confidence,
        reason: this.generateDomainReason(domain, domainInfo),
        source: 'domain_database',
      };
    }

    // Check for partial matches (e.g., edu domains)
    for (const [knownDomain, info] of this.domainDatabase.entries()) {
      if (domain.endsWith(knownDomain) && knownDomain.length < domain.length) {
        return {
          provider: info.provider,
          confidence: info.confidence * 0.8, // Reduce confidence for partial matches
          reason: `${domain} appears to be a ${info.type} domain`,
          source: 'domain_partial',
        };
      }
    }

    return null;
  }

  /**
   * Analyze learning data.
   * @param email
   * @param domain
   * @example
   */
  analyzeLearningData(email, domain) {
    if (!this.config.enableLearning) return null;

    const learning = this.learningData;

    // Check specific email preferences
    if (learning.userChoices[email]) {
      const choice = learning.userChoices[email];
      return {
        provider: choice.provider,
        confidence: Math.min(choice.successCount * 0.2 + 0.6, 0.95),
        reason: 'Based on your previous choice for this email',
        source: 'user_email_history',
      };
    }

    // Check domain preferences
    if (learning.domainPreferences[domain]) {
      const pref = learning.domainPreferences[domain];
      return {
        provider: pref.provider,
        confidence: Math.min(pref.count * 0.15 + 0.5, 0.85),
        reason: `You've used ${this.getProviderName(pref.provider)} for ${domain} before`,
        source: 'user_domain_history',
      };
    }

    // Check successful providers
    const successfulProvider = Object.entries(learning.successfulProviders)
      .sort(([, a], [, b]) => b.count - a.count)[0];

    if (successfulProvider && successfulProvider[1].count >= 3) {
      return {
        provider: successfulProvider[0],
        confidence: 0.4,
        reason: `${this.getProviderName(successfulProvider[0])} has worked well for you`,
        source: 'user_success_history',
      };
    }

    return null;
  }

  /**
   * Analyze corporate context.
   * @param domain
   * @example
   */
  analyzeCorporateContext(domain) {
    if (!this.config.corporateConfig) return null;

    // Direct domain mapping
    if (this.config.corporateConfig.domainMappings?.[domain]) {
      const provider = this.config.corporateConfig.domainMappings[domain];
      return {
        provider,
        confidence: 0.95,
        reason: `${domain} is configured for ${this.getProviderName(provider)} in your organization`,
        source: 'corporate_mapping',
      };
    }

    // Corporate email domains
    if (this.config.corporateConfig.emailDomains?.includes(domain)) {
      const { preferredProvider } = this.config.corporateConfig;
      if (preferredProvider) {
        return {
          provider: preferredProvider,
          confidence: 0.8,
          reason: `Your organization prefers ${this.getProviderName(preferredProvider)}`,
          source: 'corporate_preference',
        };
      }
    }

    return null;
  }

  /**
   * Analyze department context.
   * @param domain
   * @example
   */
  analyzeDepartmentContext(domain) {
    if (!this.config.department) return null;

    // Department-specific provider preferences
    const deptPreferences = {
      sistemas: 'google',
      marketing: 'google',
      finanzas: 'microsoft',
      rrhh: 'microsoft',
      legal: 'microsoft',
    };

    const preferredProvider = deptPreferences[this.config.department];
    if (preferredProvider) {
      return {
        provider: preferredProvider,
        confidence: 0.6,
        reason: `${this.getProviderName(preferredProvider)} is commonly used in ${this.config.department}`,
        source: 'department_preference',
      };
    }

    return null;
  }

  /**
   * Analyze common patterns.
   * @param domain
   * @example
   */
  analyzeCommonPatterns(domain) {
    // Educational institutions typically use Google
    if (domain.includes('edu') || domain.includes('school') || domain.includes('university')) {
      return {
        provider: 'google',
        confidence: 0.7,
        reason: 'Educational institutions commonly use Google Workspace',
        source: 'pattern_education',
      };
    }

    // Government domains often use Microsoft
    if (domain.includes('gov') || domain.includes('gob')) {
      return {
        provider: 'microsoft',
        confidence: 0.65,
        reason: 'Government organizations often use Microsoft 365',
        source: 'pattern_government',
      };
    }

    // Tech companies often use Google
    if (domain.includes('tech') || domain.includes('software') || domain.includes('dev')) {
      return {
        provider: 'google',
        confidence: 0.6,
        reason: 'Tech companies commonly use Google Workspace',
        source: 'pattern_tech',
      };
    }

    return null;
  }

  /**
   * Show suggestion.
   * @param suggestion
   * @example
   */
  showSuggestion(suggestion) {
    if (!suggestion || !this.elements.suggestionArea) return;

    this.currentSuggestion = suggestion;

    // Update suggestion text
    const providerName = this.getProviderName(suggestion.provider);

    // Clear and rebuild suggestion text using DOM methods
    this.elements.suggestionText.textContent = '';

    const mainText = document.createTextNode(`We recommend signing in with ${providerName}`);
    this.elements.suggestionText.appendChild(mainText);

    if (this.config.showSuggestionReason && suggestion.reason) {
      const reasonDiv = document.createElement('div');
      reasonDiv.className = 'suggestion-reason';
      reasonDiv.textContent = suggestion.reason; // Safe: using textContent
      this.elements.suggestionText.appendChild(reasonDiv);
    }

    // Update accept button
    this.elements.suggestionAccept.textContent = `Continue with ${providerName}`;
    this.elements.suggestionAccept.onclick = () => {
      this.acceptSuggestion(suggestion);
    };

    // Update dismiss button
    this.elements.suggestionDismiss.onclick = () => {
      this.dismissSuggestion(suggestion);
    };

    // Show suggestion area
    this.elements.suggestionArea.style.display = 'block';

    // Highlight suggested provider in main grid
    this.highlightSuggestedProvider(suggestion.provider);

    // Move alternatives to separate section
    this.updateAlternativesDisplay(suggestion.provider);

    // Track suggestion shown
    this.trackSuggestionShown(suggestion);
  }

  /**
   * Hide suggestion.
   * @example
   */
  hideSuggestion() {
    if (this.elements.suggestionArea) {
      this.elements.suggestionArea.style.display = 'none';
    }

    this.currentSuggestion = null;
    this.clearProviderHighlights();
    this.updateAlternativesDisplay();
  }

  /**
   * Accept suggestion.
   * @param suggestion
   * @example
   */
  acceptSuggestion(suggestion) {
    // Record acceptance in learning data
    this.recordSuggestionAcceptance(suggestion);

    // Select the provider
    this.selectProvider(suggestion.provider);

    // Track acceptance
    this.trackSuggestionInteraction({
      type: 'accepted',
      suggestion,
    });
  }

  /**
   * Dismiss suggestion.
   * @param suggestion
   * @example
   */
  dismissSuggestion(suggestion) {
    // Record dismissal in learning data
    this.recordSuggestionDismissal(suggestion);

    // Hide suggestion
    this.hideSuggestion();

    // Track dismissal
    this.trackSuggestionInteraction({
      type: 'dismissed',
      suggestion,
    });
  }

  /**
   * Select provider.
   * @param provider
   * @example
   */
  selectProvider(provider) {
    // Record user choice
    this.recordUserChoice(provider);

    // Trigger provider selection event
    const event = new CustomEvent('providerSelected', {
      detail: {
        provider,
        suggestion: this.currentSuggestion,
        intelligent: !!this.currentSuggestion,
        timestamp: new Date(),
      },
    });
    document.dispatchEvent(event);

    // Call OAuth provider if available
    if (window.authenticateWithProvider) {
      window.authenticateWithProvider(provider);
    }

    // Track selection
    this.trackProviderSelection({
      provider,
      fromSuggestion: !!this.currentSuggestion,
      suggestion: this.currentSuggestion,
    });
  }

  /**
   * Highlight suggested provider.
   * @param provider
   * @example
   */
  highlightSuggestedProvider(provider) {
    // Clear existing highlights
    this.clearProviderHighlights();

    // Add suggestion highlight
    const providerButton = this.elements.providerGrid.querySelector(`[data-provider="${provider}"]`);
    if (providerButton) {
      providerButton.classList.add('suggested');

      // Add confidence indicator
      const confidence = this.currentSuggestion?.confidence || 0;
      const confidenceIndicator = document.createElement('div');
      confidenceIndicator.className = `confidence-indicator ${this.getConfidenceClass(confidence)}`;
      confidenceIndicator.textContent = `${Math.round(confidence * 100)}%`;
      confidenceIndicator.title = `${Math.round(confidence * 100)}% confidence`;

      providerButton.appendChild(confidenceIndicator);
    }
  }

  /**
   * Clear provider highlights.
   * @example
   */
  clearProviderHighlights() {
    const buttons = this.elements.providerGrid.querySelectorAll('.provider-button');
    buttons.forEach((button) => {
      button.classList.remove('suggested');
      const indicator = button.querySelector('.confidence-indicator');
      if (indicator) {
        indicator.remove();
      }
    });
  }

  /**
   * Update alternatives display.
   * @param excludeProvider
   * @example
   */
  updateAlternativesDisplay(excludeProvider = null) {
    if (!this.elements.alternatives) return;

    const alternatives = this.config.availableProviders.filter((p) => p !== excludeProvider);

    if (excludeProvider && alternatives.length > 0) {
      // Show alternatives
      this.elements.alternatives.style.display = 'block';

      // Clear existing alternatives
      // Clear existing alternatives safely
      while (this.elements.alternativesGrid.firstChild) {
        this.elements.alternativesGrid.removeChild(this.elements.alternativesGrid.firstChild);
      }

      // Add alternative buttons
      alternatives.forEach((provider) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'alternative-button';
        button.textContent = this.getProviderName(provider);
        button.onclick = () => this.selectProvider(provider);

        this.elements.alternativesGrid.appendChild(button);
      });
    } else {
      // Hide alternatives
      this.elements.alternatives.style.display = 'none';
    }
  }

  /**
   * Record suggestion acceptance.
   * @param suggestion
   * @example
   */
  recordSuggestionAcceptance(suggestion) {
    if (!this.config.enableLearning) return;

    // Update user choices
    if (suggestion.email) {
      this.learningData.userChoices[suggestion.email] = {
        provider: suggestion.provider,
        successCount: (this.learningData.userChoices[suggestion.email]?.successCount || 0) + 1,
        lastUsed: new Date().toISOString(),
      };
    }

    // Update domain preferences
    if (suggestion.domain) {
      if (!this.learningData.domainPreferences[suggestion.domain]) {
        this.learningData.domainPreferences[suggestion.domain] = {
          provider: suggestion.provider,
          count: 0,
        };
      }
      this.learningData.domainPreferences[suggestion.domain].count++;
    }

    this.saveLearningData();
  }

  /**
   * Record suggestion dismissal.
   * @param suggestion
   * @example
   */
  recordSuggestionDismissal(suggestion) {
    if (!this.config.enableLearning) return;

    const key = `${suggestion.email || suggestion.domain}_${suggestion.provider}`;
    this.learningData.rejectedSuggestions[key] = {
      count: (this.learningData.rejectedSuggestions[key]?.count || 0) + 1,
      lastRejected: new Date().toISOString(),
      reason: suggestion.source,
    };

    this.saveLearningData();
  }

  /**
   * Record user choice.
   * @param provider
   * @example
   */
  recordUserChoice(provider) {
    if (!this.config.enableLearning) return;

    // Update successful providers
    if (!this.learningData.successfulProviders[provider]) {
      this.learningData.successfulProviders[provider] = { count: 0 };
    }
    this.learningData.successfulProviders[provider].count++;
    this.learningData.successfulProviders[provider].lastUsed = new Date().toISOString();

    this.saveLearningData();
  }

  /**
   * Detect contextual provider.
   * @example
   */
  detectContextualProvider() {
    // URL-based detection
    const urlParams = new URLSearchParams(window.location.search);
    const preferredProvider = urlParams.get('provider') || urlParams.get('oauth');

    if (preferredProvider && this.config.availableProviders.includes(preferredProvider)) {
      this.showSuggestion({
        provider: preferredProvider,
        confidence: 0.9,
        reason: 'Selected from URL parameter',
        source: 'url_parameter',
      });
    }

    // Referrer-based detection
    const { referrer } = document;
    if (referrer) {
      try {
        const referrerDomain = new URL(referrer).hostname;
        const domainInfo = this.domainDatabase.get(referrerDomain);

        if (domainInfo) {
          setTimeout(() => {
            if (!this.currentSuggestion) { // Only suggest if no other suggestion active
              this.showSuggestion({
                provider: domainInfo.provider,
                confidence: 0.7,
                reason: `You came from ${referrerDomain}`,
                source: 'referrer',
              });
            }
          }, 1000);
        }
      } catch (error) {
        // Invalid referrer URL
      }
    }
  }

  /**
   * Setup UI interactions.
   * @example
   */
  setupUIInteractions() {
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.currentSuggestion) {
        this.dismissSuggestion(this.currentSuggestion);
      }
    });

    // Touch gestures for mobile
    if ('ontouchstart' in window) {
      this.setupTouchGestures();
    }
  }

  /**
   * Setup touch gestures for mobile.
   * @example
   */
  setupTouchGestures() {
    let startX = 0;
    let startY = 0;

    this.elements.suggestionArea?.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    });

    this.elements.suggestionArea?.addEventListener('touchend', (e) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;

      const deltaX = endX - startX;
      const deltaY = endY - startY;

      // Swipe right to dismiss suggestion
      if (deltaX > 100 && Math.abs(deltaY) < 50) {
        this.dismissSuggestion(this.currentSuggestion);
      }
    });
  }

  /**
   * Track suggestion shown.
   * @param suggestion
   * @example
   */
  trackSuggestionShown(suggestion) {
    // Implementation for analytics tracking
    console.log('Suggestion shown:', suggestion);
  }

  /**
   * Track suggestion interaction.
   * @param detail
   * @example
   */
  trackSuggestionInteraction(detail) {
    const event = new CustomEvent('suggestionInteraction', { detail });
    document.dispatchEvent(event);
  }

  /**
   * Track provider selection.
   * @param detail
   * @example
   */
  trackProviderSelection(detail) {
    const event = new CustomEvent('providerSelected', { detail });
    document.dispatchEvent(event);
  }

  /**
   * Utility methods.
   * @param provider
   * @example
   */
  getProviderName(provider) {
    const names = {
      google: 'Google',
      microsoft: 'Microsoft',
      apple: 'Apple',
    };
    return names[provider] || provider;
  }

  getProviderIcon(provider) {
    // Return SVG icons or placeholder
    return '<div style="width: 32px; height: 32px; background: #ddd; border-radius: 4px;"></div>';
  }

  getConfidenceClass(confidence) {
    if (confidence >= 0.8) return 'confidence-high';
    if (confidence >= 0.6) return 'confidence-medium';
    return 'confidence-low';
  }

  generateDomainReason(domain, domainInfo) {
    switch (domainInfo.type) {
      case 'corporate_verified':
        return `${domain} is configured in your organization`;
      case 'corporate':
        return `${domain} typically uses ${this.getProviderName(domainInfo.provider)}`;
      case 'consumer':
        return `${domain} accounts work with ${this.getProviderName(domainInfo.provider)}`;
      case 'educational':
        return `Educational domains like ${domain} commonly use ${this.getProviderName(domainInfo.provider)}`;
      default:
        return `Based on ${domain} domain`;
    }
  }

  /**
   * Public methods.
   * @param newConfig
   * @example
   */
  updateConfiguration(newConfig) {
    Object.assign(this.config, newConfig);
    this.initialize();
  }

  forceRefresh() {
    this.clearProviderHighlights();
    this.hideSuggestion();
    this.detectContextualProvider();
  }

  getCurrentSuggestion() {
    return this.currentSuggestion;
  }

  getLearningData() {
    return this.learningData;
  }

  clearLearningData() {
    this.learningData = {
      userChoices: {},
      domainPreferences: {},
      successfulProviders: {},
      rejectedSuggestions: {},
    };
    this.saveLearningData();
  }
}

// Export for use in browser
window.IntelligentProviderSelector = IntelligentProviderSelector;

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('[data-intelligent-provider-selector]');
  if (container) {
    const config = container.dataset.config ? JSON.parse(container.dataset.config) : {};
    config.container = container;

    window.intelligentProviderSelector = new IntelligentProviderSelector(config);
  }
});
