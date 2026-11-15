(function () {
  "use strict";

  const MAX_PICTURE_BYTES = 1024 * 1024;
  const validSkillLevels = ["Beginner", "Advanced Beginner", "Intermediate", "Pro"];
  const avatarColors = {
    green: "#4a9a50",
    sky: "#4c8eb5",
    sun: "#d99b3d",
    berry: "#a85d78"
  };
  const panels = Array.from(document.querySelectorAll("[data-setup-step]"));
  const progressLabel = document.getElementById("setup-progress-label");
  const progressTrack = document.querySelector(".setup-progress-track");
  const progressFill = document.getElementById("setup-progress-fill");
  const backButton = document.getElementById("setup-back");
  const status = document.getElementById("setup-status");
  const nameInput = document.getElementById("setup-name");
  const pictureInput = document.getElementById("setup-picture");
  const picturePreview = document.getElementById("setup-avatar-preview");
  const initials = document.getElementById("setup-avatar-initials");
  const completePanel = document.querySelector("[data-setup-complete]");
  let userId = "";
  let profile = null;
  let activeStep = 0;
  let selectedAvatar = "";
  let selectedSkill = "";
  let pictureData = "";

  function showSetupError(error) {
    const message = error && error.message ? error.message : "Unable to load your profile setup.";
    status.textContent = /column .* does not exist|schema cache/i.test(message)
      ? "Profile setup needs the latest Supabase schema. Run the updated supabase-setup.sql script, then reload this page."
      : message;
  }

  function defaultAvatar(color) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">'
      + '<rect width="160" height="160" rx="80" fill="' + color + '"/>'
      + '<circle cx="80" cy="58" r="28" fill="#fff" fill-opacity=".95"/>'
      + '<path d="M28 148c4-34 23-51 52-51s48 17 52 51" fill="#fff" fill-opacity=".95"/>'
      + "</svg>";
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  }

  function showPreview(source, name) {
    if (source) {
      picturePreview.src = source;
      picturePreview.hidden = false;
      initials.hidden = true;
    } else {
      picturePreview.removeAttribute("src");
      picturePreview.hidden = true;
      initials.textContent = (name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("") || "PQ")
        .toLocaleUpperCase();
      initials.hidden = false;
    }
  }

  function setAvatarChoice(choice) {
    selectedAvatar = choice;
    pictureData = "";
    pictureInput.value = "";
    document.querySelectorAll("[data-avatar-choice]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.avatarChoice === choice));
    });
    showPreview(defaultAvatar(avatarColors[choice]), nameInput.value);
  }

  function renderStep() {
    const isComplete = activeStep === panels.length;
    panels.forEach((panel, index) => {
      panel.hidden = index !== activeStep || isComplete;
    });
    completePanel.hidden = !isComplete;
    backButton.disabled = activeStep === 0;
    progressLabel.textContent = isComplete ? "3 of 3 · Complete" : (activeStep + 1) + " of 3";
    progressFill.style.width = (isComplete ? 100 : ((activeStep + 1) / panels.length) * 100) + "%";
    progressTrack.setAttribute("aria-valuenow", String(isComplete ? panels.length : activeStep + 1));
    status.textContent = "";
  }

  async function saveFields(step) {
    const updates = { updated_at: new Date().toISOString() };
    if (step === 0) {
      const displayName = nameInput.value.trim();
      if (!displayName) {
        status.textContent = "Enter a display name or skip this step.";
        nameInput.focus();
        return false;
      }
      updates.display_name = displayName;
    } else if (step === 1) {
      updates.avatar_data_url = pictureData || defaultAvatar(avatarColors[selectedAvatar || "green"]);
    } else if (step === 2) {
      if (!selectedSkill) {
        status.textContent = "Choose a skill level or skip this step.";
        return false;
      }
      updates.skill_level = selectedSkill || null;
    }

    const { data: updatedProfile, error } = await window.piqueueSupabase.from("profiles")
      .update(updates)
      .eq("id", userId)
      .select("id, display_name, avatar_data_url, skill_level, profile_setup_complete")
      .single();
    if (error) throw error;
    profile = updatedProfile;
    return true;
  }

  backButton.addEventListener("click", () => {
    if (activeStep > 0) {
      activeStep -= 1;
      renderStep();
    }
  });

  document.querySelectorAll("[data-setup-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.setupAction;
      if (action === "continue") {
        button.disabled = true;
        try {
          if (!await saveFields(activeStep)) return;
        } catch (error) {
          status.textContent = error.message || "Unable to save this profile step.";
          return;
        } finally {
          button.disabled = false;
        }
      }
      activeStep += 1;
      renderStep();
    });
  });

  document.querySelectorAll("[data-avatar-choice]").forEach((button) => {
    button.addEventListener("click", () => setAvatarChoice(button.dataset.avatarChoice));
  });

  document.querySelectorAll("[data-skill-level]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSkill = button.dataset.skillLevel;
      document.querySelectorAll("[data-skill-level]").forEach((option) => {
        option.setAttribute("aria-pressed", String(option === button));
      });
    });
  });

  pictureInput.addEventListener("change", () => {
    const file = pictureInput.files[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      pictureInput.value = "";
      status.textContent = "Choose a PNG, JPEG, WebP, or GIF image.";
      return;
    }
    if (file.size > MAX_PICTURE_BYTES) {
      pictureInput.value = "";
      status.textContent = "Profile pictures must be 1 MB or smaller.";
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        status.textContent = "The selected picture could not be read.";
        return;
      }
      pictureData = reader.result;
      selectedAvatar = "";
      document.querySelectorAll("[data-avatar-choice]").forEach((button) => {
        button.setAttribute("aria-pressed", "false");
      });
      showPreview(pictureData, nameInput.value || profile.display_name);
      status.textContent = "Photo selected.";
    });
    reader.addEventListener("error", () => {
      status.textContent = "Unable to read the selected picture.";
    });
    reader.readAsDataURL(file);
  });

  nameInput.addEventListener("input", () => {
    if (!pictureData && selectedAvatar) {
      showPreview(defaultAvatar(avatarColors[selectedAvatar]), nameInput.value);
    }
  });

  document.getElementById("queue-up-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { error } = await window.piqueueSupabase.from("profiles").update({
        profile_setup_complete: true,
        updated_at: new Date().toISOString()
      }).eq("id", userId);
      if (error) throw error;
      window.location.replace("home.html");
    } catch (error) {
      status.textContent = error.message || "Unable to finish profile setup.";
      button.disabled = false;
    }
  });

  window.piqueueAuth.ready.then(async (session) => {
    if (!session) {
      window.location.replace("index.html");
      return;
    }
    userId = session.user.id;
    const { data, error } = await window.piqueueSupabase.from("profiles")
      .select("id, display_name, avatar_data_url, skill_level, profile_setup_complete")
      .eq("id", userId)
      .single();
    if (error) throw error;
    if (data.profile_setup_complete) {
      window.location.replace("home.html");
      return;
    }
    profile = data;
    nameInput.value = profile.display_name || "";
    selectedSkill = validSkillLevels.includes(profile.skill_level) ? profile.skill_level : "";
    document.querySelectorAll("[data-skill-level]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.skillLevel === selectedSkill));
    });
    if (profile.avatar_data_url) showPreview(profile.avatar_data_url, profile.display_name);
    else setAvatarChoice("green");
    renderStep();
  }).catch((error) => {
    showSetupError(error);
  });
}());
