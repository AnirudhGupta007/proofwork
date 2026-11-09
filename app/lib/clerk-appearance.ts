// Proofwork brand palette for Clerk's hosted components (dark theme).
const bg = "#0A0B0A";
const ink = "#F5F1E6";
const muted = "rgba(245, 241, 230, 0.62)";
const line = "rgba(245, 241, 230, 0.12)";
const lineStrong = "rgba(245, 241, 230, 0.28)";
const inputBg = "rgba(245, 241, 230, 0.04)";
const accent = "#1E4D3A";
const accentStrong = "#245C45";
const accentTint = "#8CC2A4";
const bodyFont = "\"Instrument Sans\", ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
const displayFont = "\"Instrument Serif\", Georgia, serif";

export const clerkAppearance = {
  variables: {
    colorPrimary: accent,
    colorBackground: bg,
    colorText: ink,
    colorTextSecondary: muted,
    colorTextOnPrimaryBackground: ink,
    colorNeutral: ink,
    colorInputBackground: inputBg,
    colorInputText: ink,
    colorDanger: "#D98C80",
    colorSuccess: accentTint,
    colorWarning: "#D2B072",
    borderRadius: "4px",
    fontFamily: bodyFont,
    fontFamilyButtons: bodyFont
  },
  elements: {
    rootBox: {
      width: "100%"
    },
    cardBox: {
      width: "100%",
      boxShadow: "none",
      borderRadius: "4px",
      border: `1px solid ${line}`,
      padding: "0",
      backgroundColor: bg
    },
    card: {
      boxShadow: "none",
      borderRadius: "0",
      backgroundColor: bg,
      border: "0",
      padding: "0"
    },
    headerTitle: {
      fontFamily: displayFont,
      fontSize: "34px",
      fontWeight: "400",
      letterSpacing: "-0.01em",
      color: ink
    },
    headerSubtitle: {
      color: muted,
      fontSize: "14px"
    },
    socialButtonsBlockButton: {
      borderRadius: "4px",
      borderColor: lineStrong,
      backgroundColor: "transparent",
      boxShadow: "none",
      color: ink
    },
    socialButtonsBlockButtonText: {
      color: ink
    },
    dividerLine: {
      backgroundColor: line
    },
    dividerText: {
      color: muted
    },
    formFieldLabel: {
      color: ink,
      fontWeight: "500"
    },
    formField: {
      width: "100%"
    },
    formFieldRow: {
      display: "grid",
      gridTemplateColumns: "1fr",
      width: "100%"
    },
    formFieldRow__name: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      width: "100%"
    },
    formFieldInput: {
      borderRadius: "4px",
      borderColor: lineStrong,
      backgroundColor: inputBg,
      boxShadow: "none",
      color: ink,
      width: "100%",
      minHeight: "42px",
      padding: "0 12px"
    },
    formButtonPrimary: {
      borderRadius: "4px",
      backgroundColor: accent,
      boxShadow: "none",
      color: ink,
      fontWeight: "500",
      "&:hover": {
        backgroundColor: accentStrong
      }
    },
    footer: {
      borderRadius: "0",
      background: bg,
      backgroundColor: bg
    },
    footerActionText: {
      color: muted
    },
    footerActionLink: {
      color: accentTint,
      fontWeight: "600"
    },
    identityPreview: {
      borderRadius: "4px",
      borderColor: line,
      backgroundColor: inputBg
    },
    identityPreviewText: {
      color: ink
    },
    identityPreviewEditButton: {
      color: accentTint
    },
    formResendCodeLink: {
      color: accentTint
    },
    otpCodeFieldInput: {
      borderRadius: "4px",
      borderColor: lineStrong,
      color: ink,
      boxShadow: "none"
    }
  }
};
