(function () {
  'use strict';

  var measurementId = 'G-LEBSQ97VK4';
  var consentKey = 'reditgrab_analytics_consent';
  var loaded = false;

  function setConsent(value) {
    try {
      window.localStorage.setItem(consentKey, value);
    } catch (error) {
      // The choice still applies to analytics on this page when storage is unavailable.
    }

    if (window.gtag) {
      window.gtag('consent', 'update', {
        analytics_storage: value === 'accepted' ? 'granted' : 'denied'
      });
    }

    if (value === 'accepted') loadAnalytics();
    if (value === 'rejected') clearAnalyticsCookies();
  }

  function loadAnalytics() {
    if (loaded) return;
    loaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('js', new Date());
    window.gtag('config', measurementId);

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    document.head.appendChild(script);
  }

  function clearAnalyticsCookies() {
    document.cookie.split(';').forEach(function (cookie) {
      var name = cookie.split('=')[0].trim();
      if (name === '_ga' || name.indexOf('_ga_') === 0) {
        document.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax';
        document.cookie = name + '=; Max-Age=0; path=/; domain=.reditgrab.com; SameSite=Lax';
      }
    });
  }

  function addChoicePanel() {
    if (document.getElementById('analytics-consent-panel')) return;

    var panel = document.createElement('section');
    panel.id = 'analytics-consent-panel';
    panel.className = 'analytics-consent-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Analytics preferences');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<div class="analytics-consent-copy"><strong>Help improve Reddit Downloader</strong><p>Optional Google Analytics helps us understand visits and improve the site. It uses analytics cookies and receives usage, browser, device, and approximate location information. The downloader works if you reject. <a href="/privacy">Privacy details</a></p></div><div class="analytics-consent-actions"><button type="button" class="analytics-consent-reject">Reject optional analytics</button><button type="button" class="analytics-consent-accept">Accept analytics</button></div>';

    panel.querySelector('.analytics-consent-accept').addEventListener('click', function () {
      setConsent('accepted');
      panel.remove();
    });
    panel.querySelector('.analytics-consent-reject').addEventListener('click', function () {
      setConsent('rejected');
      panel.remove();
    });

    document.body.appendChild(panel);
  }

  function showChoicePanel() {
    addChoicePanel();
    var panel = document.getElementById('analytics-consent-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var choice = null;
    try {
      choice = window.localStorage.getItem(consentKey);
    } catch (error) {
      choice = null;
    }

    if (choice === 'accepted') loadAnalytics();
    else if (choice !== 'rejected') addChoicePanel();

    document.querySelectorAll('[data-manage-analytics]').forEach(function (button) {
      button.addEventListener('click', showChoicePanel);
    });
    window.addEventListener('show-analytics-consent', showChoicePanel);
  });
})();

