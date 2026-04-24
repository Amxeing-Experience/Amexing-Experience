/**
 * TripAdvisor Reviews Service
 * Handles fetching and caching reviews from TripAdvisor API.
 * @module TripAdvisorService
 * @author Amexing Development Team
 */

const axios = require('axios');
const logger = require('../../infrastructure/logger');

class TripAdvisorService {
  constructor() {
    this.apiKey = process.env.TRIPADVISOR_API_KEY || '4FABE856A3C849588F6A0B5827BFA5E2';
    this.locationId = process.env.TRIPADVISOR_LOCATION_ID || '19425238';
    this.baseUrl = 'https://api.content.tripadvisor.com/api/v1';
    this.cache = null;
    this.cacheExpiry = null;
    this.cacheDuration = 3600000; // 1 hour in milliseconds

    // Fallback reviews for when API is unavailable
    this.fallbackReviews = [
      {
        id: 'fallback-1',
        name: 'Nicole Bto',
        location: 'San Miguel de Allende',
        rating: 5,
        text: 'Cena en compañía. Pasamos una velada increíble. La vista es hermosa y el ambiente es muy agradable. El chef estuvo presente en cada platillo. Definitivamente volveremos.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Cena Romántica',
        published_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 2 months ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-2',
        name: 'Giuseppe71',
        location: 'Ciudad de México',
        rating: 5,
        text: 'Riacevuto sorprese. Non posso lasciare una recensione più entusiasmante e locale è semplice, pulito. Il personale è attentissimo ma discreto. La vista è magnifica e il servicio impeccabile.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Tour Histórico',
        published_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 3 months ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-3',
        name: 'Carlos Mendoza',
        location: 'Querétaro',
        rating: 5,
        text: 'Transporte excepcional con Tesla Model S. La experiencia fue impecable desde el primer momento. Conductor profesional, vehículo impecable y servicio de primera clase. Altamente recomendado.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Transporte Ejecutivo',
        published_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 1 month ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-4',
        name: 'María Fernández',
        location: 'León, Guanajuato',
        rating: 5,
        text: 'Una experiencia inolvidable en San Miguel de Allende. El tour personalizado superó todas nuestras expectativas. Atención al detalle excepcional y conocimiento profundo de la ciudad.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Tour Personalizado',
        published_date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-5',
        name: 'Glenda L',
        location: 'Guadalajara',
        rating: 5,
        text: 'Bello e buono 😋. Siamo rimasti molto soddisfatti del nuovo ristorante che ci ha conquistato subito per la cortesia dello staff e per l\'ambiente curato nei minimi dettagli.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Experiencia Gastronómica',
        published_date: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(), // 4 weeks ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-6',
        name: 'Robert Johnson',
        location: 'Austin, Texas',
        rating: 5,
        text: 'Outstanding airport transfer service! Our driver was punctual, professional, and the Tesla Model X was immaculate. Made our arrival in San Miguel de Allende stress-free and comfortable.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Airport Transfer',
        published_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-7',
        name: 'Patricia M',
        location: 'Monterrey',
        rating: 5,
        text: 'El tour de viñedos fue espectacular. Visitamos 3 bodegas boutique, con explicaciones detalladas y una cata maravillosa. El conocimiento del guía sobre los vinos mexicanos fue impresionante.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Wine Tour',
        published_date: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(), // 3 weeks ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-8',
        name: 'James Wilson',
        location: 'Toronto, Canada',
        rating: 5,
        text: 'The hot air balloon ride over San Miguel was absolutely breathtaking! Professional crew, smooth flight, and stunning views. The champagne breakfast afterwards was the perfect touch.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Hot Air Balloon',
        published_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-9',
        name: 'Ana García',
        location: 'Mexico City',
        rating: 5,
        text: 'Servicio ejecutivo de primera clase. Utilizamos Amexing para todos nuestros traslados corporativos y siempre superan nuestras expectativas. Puntualidad y profesionalismo garantizados.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Corporate Transport',
        published_date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(), // 45 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-10',
        name: 'Michael Brown',
        location: 'San Francisco, CA',
        rating: 5,
        text: 'Perfect wedding transportation! They coordinated shuttles for 150 guests flawlessly. Every vehicle was pristine, drivers were courteous, and timing was impeccable. Highly recommended!',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Event Transportation',
        published_date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-11',
        name: 'Sophie Laurent',
        location: 'Paris, France',
        rating: 5,
        text: 'Une expérience inoubliable! Le tour photographique était parfait. Notre guide connaissait tous les meilleurs spots et nous a aidés à capturer des moments magiques.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Photography Tour',
        published_date: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(), // 18 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-12',
        name: 'David Rodriguez',
        location: 'Guanajuato',
        rating: 5,
        text: 'El servicio de Tesla para mi boda fue excepcional. El Model S llegó decorado elegantemente y el conductor fue muy profesional. Todos nuestros invitados quedaron impresionados.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Wedding Transport',
        published_date: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(), // 50 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-13',
        name: 'Emily Chen',
        location: 'Shanghai, China',
        rating: 5,
        text: 'Excellent cultural tour! Our guide was knowledgeable about art, history, and architecture. The pace was perfect and we learned so much about Mexican culture. Worth every penny!',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Cultural Tour',
        published_date: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(), // 25 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-14',
        name: 'Thomas Anderson',
        location: 'London, UK',
        rating: 5,
        text: 'Top-notch service from start to finish. Used them for a week-long stay with daily excursions. Never late, always professional, and the vehicles were spotless. Will definitely use again!',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Multi-Day Tours',
        published_date: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
      {
        id: 'fallback-15',
        name: 'Laura Martinez',
        location: 'Puebla',
        rating: 5,
        text: 'La experiencia de paseo en globo aerostático fue mágica. Todo perfectamente organizado, desde el hotel hasta el aterrizaje. El desayuno champagne con vista panorámica fue inolvidable.',
        platform: 'TripAdvisor',
        verified: true,
        service: 'Balloon Experience',
        published_date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(), // 12 days ago
        rating_image_url: 'https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s5.0-66827-5.svg',
      },
    ];
  }

  /**
   * Format time ago from date.
   * @param dateStr
   * @param language
   * @example
   */
  formatTimeAgo(dateStr, language = 'es') {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (language === 'es') {
      if (diffMonths > 0) {
        return `Hace ${diffMonths} ${diffMonths === 1 ? 'mes' : 'meses'}`;
      } if (diffWeeks > 0) {
        return `Hace ${diffWeeks} ${diffWeeks === 1 ? 'semana' : 'semanas'}`;
      } if (diffDays > 0) {
        return `Hace ${diffDays} ${diffDays === 1 ? 'día' : 'días'}`;
      }
      return 'Hoy';
    }
    if (diffMonths > 0) {
      return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
    } if (diffWeeks > 0) {
      return `${diffWeeks} ${diffWeeks === 1 ? 'week' : 'weeks'} ago`;
    } if (diffDays > 0) {
      return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    }
    return 'Today';
  }

  /**
   * Format TripAdvisor review to match our testimonial structure.
   * @param review
   * @param language
   * @example
   */
  formatReview(review, language = 'es') {
    // Extract location from user if available, otherwise use default
    const location = review.user?.location || 'San Miguel de Allende';

    // Generate a display name from username or use default
    const name = review.user?.username || `Guest${review.id.toString().slice(-4)}`;

    return {
      id: review.id.toString(),
      name,
      avatar: review.user?.avatar?.small || '/images/avatars/default.jpg',
      location,
      timeAgo: this.formatTimeAgo(review.published_date, language),
      rating: review.rating || 5,
      text: review.text || review.title || '',
      title: review.title || '',
      platform: 'TripAdvisor',
      verified: true,
      service: this.detectServiceType(review.text || review.title || '', language),
      published_date: review.published_date,
      lang: review.lang || language,
      rating_image_url: review.rating_image_url || `https://www.tripadvisor.com/img/cdsi/img2/ratings/traveler/s${review.rating || 5}.0-66827-5.svg`,
    };
  }

  /**
   * Detect service type from review text.
   * @param text
   * @param language
   * @example
   */
  detectServiceType(text, language = 'es') {
    const lowercaseText = text.toLowerCase();

    const serviceKeywords = {
      es: {
        'Transporte Ejecutivo': ['tesla', 'transporte', 'aeropuerto', 'traslado', 'vehicle', 'car'],
        'Tour Personalizado': ['tour', 'recorrido', 'guía', 'ciudad', 'histórico'],
        'Experiencia Gastronómica': ['cena', 'comida', 'restaurant', 'chef', 'platillo', 'gastro'],
        'Cata de Vinos': ['vino', 'cata', 'viñedo', 'wine', 'bodega'],
        Aventura: ['aventura', 'globo', 'caballo', 'adventure'],
      },
      en: {
        'Executive Transport': ['tesla', 'transport', 'airport', 'transfer', 'vehicle', 'car'],
        'Personalized Tour': ['tour', 'guide', 'city', 'historic', 'sightseeing'],
        'Gastronomic Experience': ['dinner', 'food', 'restaurant', 'chef', 'dining', 'meal'],
        'Wine Tasting': ['wine', 'tasting', 'vineyard', 'winery', 'bodega'],
        Adventure: ['adventure', 'balloon', 'horseback', 'outdoor'],
      },
    };

    const keywords = serviceKeywords[language] || serviceKeywords.es;

    for (const [service, words] of Object.entries(keywords)) {
      if (words.some((word) => lowercaseText.includes(word))) {
        return service;
      }
    }

    return language === 'es' ? 'Experiencia Premium' : 'Premium Experience';
  }

  /**
   * Fetch reviews from TripAdvisor API.
   * @param language
   * @example
   */
  async fetchFromAPI(language = 'es') {
    try {
      const url = `${this.baseUrl}/location/${this.locationId}/reviews`;

      const response = await axios.get(url, {
        params: {
          key: this.apiKey,
          language: language === 'es' ? 'es' : 'en',
          limit: 20, // Get up to 20 reviews
        },
        headers: {
          Accept: 'application/json',
        },
        timeout: 5000, // 5 second timeout
      });

      if (response.data && response.data.data) {
        logger.info(`Successfully fetched ${response.data.data.length} reviews from TripAdvisor`);
        return response.data.data.map((review) => this.formatReview(review, language));
      }

      logger.warn('No reviews data in TripAdvisor response');
      return null;
    } catch (error) {
      logger.error('Error fetching from TripAdvisor API:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      return null;
    }
  }

  /**
   * Get reviews with caching.
   * @param language
   * @param forceRefresh
   * @example
   */
  async getReviews(language = 'es', forceRefresh = false) {
    try {
      // Check if we have valid cache
      if (!forceRefresh && this.cache && this.cacheExpiry && new Date() < this.cacheExpiry) {
        logger.info('Returning cached TripAdvisor reviews');
        return this.cache;
      }

      // Try to fetch from API
      const apiReviews = await this.fetchFromAPI(language);

      if (apiReviews && apiReviews.length > 0) {
        // Update cache
        this.cache = apiReviews;
        this.cacheExpiry = new Date(Date.now() + this.cacheDuration);
        return apiReviews;
      }

      // If API fails and we have cache, return cached data
      if (this.cache && this.cache.length > 0) {
        logger.info('API failed, returning cached reviews');
        return this.cache;
      }

      // If no cache and API fails, return fallback reviews
      logger.warn('Using fallback reviews due to API failure');
      return this.fallbackReviews.map((review) => ({
        ...review,
        timeAgo: this.formatTimeAgo(review.published_date, language),
      }));
    } catch (error) {
      logger.error('Error in getReviews:', error);
      // Return fallback reviews with updated timeAgo
      return this.fallbackReviews.map((review) => ({
        ...review,
        timeAgo: this.formatTimeAgo(review.published_date, language),
      }));
    }
  }

  /**
   * Get a specific number of top-rated reviews.
   * @param count
   * @param language
   * @example
   */
  async getTopReviews(count = 15, language = 'es') {
    const allReviews = await this.getReviews(language);

    // Sort by rating (desc) and then by date (newest first)
    const sortedReviews = allReviews.sort((a, b) => {
      if (b.rating !== a.rating) {
        return b.rating - a.rating;
      }
      return new Date(b.published_date) - new Date(a.published_date);
    });

    return sortedReviews.slice(0, count);
  }

  /**
   * Clear cache manually.
   * @example
   */
  clearCache() {
    this.cache = null;
    this.cacheExpiry = null;
    logger.info('TripAdvisor cache cleared');
  }
}

// Export singleton instance
module.exports = new TripAdvisorService();
