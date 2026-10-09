// Fundo próprio da TXAPZONE, desenhado à mão (CSS + SVG inline, sem imagens nem bibliotecas).
// Camadas (de trás para a frente): brilhos radiais (azul #072E7B / #0048FD e um toque de amarelo #FFC107),
// grelha fina com marcas "+" nos cruzamentos, três traços diagonais de "arena" no canto e vinheta.
// Fica atrás de tudo (fixed, z-index -1, pointer-events none); os cartões continuam com superfície sólida.
// Qualidade: Alta = brilhos com deriva muito lenta; Equilibrada = estático; Poupança / reduzir movimento = só gradientes, sem SVG.
// Estilos em app/globals.css (.bd-*).

export function BrandBackdrop() {
  return (
    <div className="bd" aria-hidden="true">
      <div className="bd-glow" />
      <svg className="bd-grid" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <defs>
          <pattern id="bd-cell" width="56" height="56" patternUnits="userSpaceOnUse">
            <path d="M56 0H0V56" fill="none" stroke="#FFFFFF" strokeOpacity="0.035" strokeWidth="1" />
          </pattern>
          <pattern id="bd-cross" width="224" height="224" patternUnits="userSpaceOnUse">
            <path d="M0 -5V5M-5 0H5M224 -5V5M219 0H229M0 219V229M-5 224H5M224 219V229M219 224H229" stroke="#6E95FF" strokeOpacity="0.22" strokeWidth="1.2" strokeLinecap="round" />
            <rect x="110" y="110" width="4" height="4" fill="#FFC107" fillOpacity="0.12" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#bd-cell)" />
        <rect width="100%" height="100%" fill="url(#bd-cross)" />
      </svg>
      <svg className="bd-slash" viewBox="0 0 400 300" preserveAspectRatio="xMaxYMin meet" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <path d="M250 -10L130 310" stroke="#0048FD" strokeOpacity="0.16" strokeWidth="26" />
        <path d="M305 -10L185 310" stroke="#072E7B" strokeOpacity="0.32" strokeWidth="44" />
        <path d="M352 -10L232 310" stroke="#FFC107" strokeOpacity="0.07" strokeWidth="6" />
        <path d="M372 -10L252 310" stroke="#FFC107" strokeOpacity="0.045" strokeWidth="2" />
      </svg>
      <div className="bd-vignette" />
    </div>
  );
}
