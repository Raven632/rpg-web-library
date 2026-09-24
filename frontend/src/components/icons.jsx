import React from 'react';

// Значки меню одним стилем: тонкая линия, цвет берётся от текста (currentColor),
// поэтому при наведении они золотеют вместе с подписью. Эмодзи так не умеют —
// у каждого свои цвета, и в тёмно-золотой теме они выглядели чужими.
const Icon = ({ children }) => (
  <svg
    viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconStats = () => (
  <Icon>
    <path d="M4 20h16" />
    <path d="M7 16v-5" />
    <path d="M12 16V6" />
    <path d="M17 16v-8" />
  </Icon>
);

export const IconRefresh = () => (
  <Icon>
    <path d="M19.5 10.5A7.5 7.5 0 0 0 6.2 6.9L4.5 8.5" />
    <path d="M4.5 4.5v4h4" />
    <path d="M4.5 13.5a7.5 7.5 0 0 0 13.3 3.6l1.7-1.6" />
    <path d="M19.5 19.5v-4h-4" />
  </Icon>
);

export const IconAudit = () => (
  <Icon>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 3h6v3H9z" />
    <path d="M9 13l2.2 2.2L15.5 11" />
  </Icon>
);

export const IconLogout = () => (
  <Icon>
    <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
    <path d="M11 12h9" />
    <path d="M17 9l3 3-3 3" />
  </Icon>
);

export const IconEdit = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
);

// Бэкап сейвов — скачать к себе, импорт — загрузить обратно
export const IconDownload = () => (
  <Icon>
    <path d="M12 4v11" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Icon>
);

export const IconUpload = () => (
  <Icon>
    <path d="M12 15V4" />
    <path d="M8 8l4-4 4 4" />
    <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
  </Icon>
);
