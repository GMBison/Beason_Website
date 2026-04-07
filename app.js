(() => {
  document.body.classList.add("page-ready");

  const menuBtn = document.getElementById("menuBtn");
  const mainNav = document.getElementById("mainNav");
  const tickerTrack = document.getElementById("tickerTrack");
  const pricingTabs = document.getElementById("pricingTabs");
  const welcomeOverlay = document.getElementById("welcomeOverlay");
  const enterSiteBtn = document.getElementById("enterSiteBtn");
  const revealItems = document.querySelectorAll(".reveal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (menuBtn && mainNav) {
    menuBtn.addEventListener("click", () => {
      const expanded = menuBtn.getAttribute("aria-expanded") === "true";
      menuBtn.setAttribute("aria-expanded", String(!expanded));
      mainNav.classList.toggle("open");
    });

    mainNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mainNav.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }

  if (welcomeOverlay) {
    const dismissOverlay = () => {
      welcomeOverlay.classList.remove("is-visible");
      welcomeOverlay.classList.add("is-hidden");
    };

    requestAnimationFrame(() => {
      welcomeOverlay.classList.add("is-visible");
      welcomeOverlay.setAttribute("aria-hidden", "false");
    });

    if (enterSiteBtn) {
      enterSiteBtn.addEventListener("click", dismissOverlay);
    }

    welcomeOverlay.addEventListener("click", (event) => {
      if (event.target === welcomeOverlay) dismissOverlay();
    });
  }

  if (tickerTrack) {
    const items = [
      "100,000+ questions",
      "JAMB, WAEC and NECO coverage",
      "Offline image questions",
      "PDF and text reading",
      "Gemini online tutor",
      "Local tutor beta",
      "1-day trial key",
      "Full access on every paid plan"
    ];

    const repeated = [...items, ...items, ...items];
    tickerTrack.innerHTML = repeated.map((item) => `<span class="ticker-item">${item}</span>`).join("");

    if (!reduceMotion) {
      let offset = 0;
      const animate = () => {
        offset -= 0.4;
        if (Math.abs(offset) >= tickerTrack.scrollWidth / 3) offset = 0;
        tickerTrack.style.transform = `translateX(${offset}px)`;
        requestAnimationFrame(animate);
      };
      animate();
    }
  }

  if (pricingTabs) {
    const tabButtons = pricingTabs.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".tab-panel");

    const activateTab = (name) => {
      tabButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === name);
      });

      panels.forEach((panel) => {
        const active = panel.dataset.panel === name;
        panel.classList.toggle("active", active);
        panel.style.display = active || window.innerWidth > 1100 ? "block" : "none";
      });
    };

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => activateTab(button.dataset.tab));
    });

    const syncPricingLayout = () => {
      if (window.innerWidth > 1100) {
        panels.forEach((panel) => {
          panel.style.display = "block";
        });
      } else {
        const activeButton = pricingTabs.querySelector(".tab-btn.active");
        activateTab(activeButton ? activeButton.dataset.tab : "month");
      }
    };

    syncPricingLayout();
    window.addEventListener("resize", syncPricingLayout);
  }

  if (!reduceMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16 });

    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("in-view"));
  }

  const counters = document.querySelectorAll(".count-up");
  const formatCounter = (target) => `${target.toLocaleString()}+`;

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const element = entry.target;
      const target = Number(element.dataset.target || 0);

      if (reduceMotion) {
        element.textContent = formatCounter(target);
      } else {
        let current = 0;
        const step = Math.max(500, Math.round(target / 40));
        const tick = () => {
          current = Math.min(current + step, target);
          element.textContent = formatCounter(current);
          if (current < target) requestAnimationFrame(tick);
        };
        tick();
      }

      counterObserver.unobserve(element);
    });
  }, { threshold: 0.35 });

  counters.forEach((counter) => counterObserver.observe(counter));
})();
