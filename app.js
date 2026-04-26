(() => {
  document.body.classList.add("page-ready");

  const menuBtn = document.getElementById("menuBtn");
  const mainNav = document.getElementById("mainNav");
  const tickerTrack = document.getElementById("tickerTrack");
  const pricingTabs = document.getElementById("pricingTabs");
  const platformGrid = document.getElementById("platformGrid");
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

  if (platformGrid) {
    const downloadLinks = {
      windows: "https://mega.nz/file/mF0FFSBZ#hodmbPPFTq0w1Q2gWHrI_Hhzpwoy-pT_mCXpb2U-WK0",
      android: "https://mega.nz/file/CJF1nJiS#d6LEYPY0mDd2bT6QrcJIZH80YR5TyO1A4oE6t49rJh4"
    };
    const labels = {
      windows: "Windows",
      ios: "iOS",
      android: "Android",
      mac: "Mac"
    };
    const statusText = {
      windows: "The Windows installer is ready. Use the download button to open the official Windows build.",
      android: "The Android public beta is ready. Use the download button to open the official Android build.",
      ios: "Sorry, Beason CBT is not available for iOS yet.",
      mac: "Sorry, Beason CBT is not available for Mac yet."
    };

    const platformCards = platformGrid.querySelectorAll(".platform-card");
    const downloadActions = document.querySelectorAll("[data-download-action]");
    const downloadStatus = document.getElementById("downloadStatus");
    const floatingDownloadStatus = document.getElementById("floatingDownloadStatus");
    let selectedPlatform = "windows";

    const syncDownloadButtons = () => {
      const availableLink = downloadLinks[selectedPlatform];

      downloadActions.forEach((link) => {
        link.textContent = availableLink ? `Download ${labels[selectedPlatform]}` : `Download ${labels[selectedPlatform]}`;
        link.href = availableLink || "#";
        if (availableLink) {
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener noreferrer");
        } else {
          link.removeAttribute("target");
          link.removeAttribute("rel");
        }
      });

      if (downloadStatus) downloadStatus.textContent = statusText[selectedPlatform];
      if (floatingDownloadStatus) floatingDownloadStatus.textContent = availableLink
        ? `Use the official ${labels[selectedPlatform]} download link to continue.`
        : statusText[selectedPlatform];
    };

    const selectPlatform = (platform) => {
      selectedPlatform = platform;

      platformCards.forEach((card) => {
        const active = card.dataset.platform === platform;
        card.classList.toggle("selected", active);
        card.setAttribute("aria-pressed", String(active));
      });

      syncDownloadButtons();
    };

    platformCards.forEach((card) => {
      const chooseCard = () => selectPlatform(card.dataset.platform);

      card.addEventListener("click", (event) => {
        if (event.target.closest("a")) return;
        chooseCard();
      });

      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        chooseCard();
      });
    });

    downloadActions.forEach((link) => {
      link.addEventListener("click", (event) => {
        if (downloadLinks[selectedPlatform]) return;
        event.preventDefault();
        window.alert(statusText[selectedPlatform]);
      });
    });

    syncDownloadButtons();
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
