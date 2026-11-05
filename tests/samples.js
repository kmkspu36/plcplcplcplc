// Fixed IL samples used to detect changes in PanelLadder output. Do not edit existing entries; add new ones instead.
window.PANEL_SAMPLES = {
  selfhold: "LD X0\nOR Y0\nANI X1\nOUT Y0\nEND",
  mps: "LD X0\nMPS\nAND X1\nOUT Y0\nMRD\nANI X2\nOUT Y1\nMPP\nAND X3\nOUT Y2\nEND",
  orb: "LD X0\nAND X1\nLD X2\nAND X3\nORB\nOUT Y0\nEND",
  anb: "LD X0\nOR X1\nLD X2\nOR X3\nANB\nOUT Y0\nEND",
  setrst: "LD X0\nSET Y0\nLD X1\nRST Y0\nEND",
  timer: "LD X0\nOUT T0 K50\nLD T0\nOUT Y0\nEND",
  cnt: "LD X0\nOUT C0 K5\nLD X1\nRST C0\nLD C0\nOUT Y0\nEND",
  mov: "LD X0\nMOV K10 D0\nADD D0 K1 D1\nEND",
  badmid: "LD X0\nOUT Y0\nLD X1\nANB\nOUT Y1\nLD X2\nOUT Y2\nEND",
  multiout: "LD X0\nOUT Y0\nOUT Y1\nEND",
  outafter: "LD X0\nAND X1\nOUT Y0\nAND X2\nOUT Y1\nEND"
};
