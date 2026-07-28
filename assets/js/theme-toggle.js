/* Light/dark theme toggle.
   Kept in an external file because the compress layout collapses inline
   scripts onto one line, which turns "//" comments into script-killers. */
(function () {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const html = document.documentElement;

  if (!themeToggle || !themeIcon) return;

  const currentTheme = localStorage.getItem('theme') || 'light';
  html.setAttribute('data-theme', currentTheme);

  function setIcon(theme) {
    if (theme === 'dark') {
      themeIcon.classList.remove('fa-sun');
      themeIcon.classList.add('fa-moon');
    } else {
      themeIcon.classList.remove('fa-moon');
      themeIcon.classList.add('fa-sun');
    }
  }

  setIcon(currentTheme);

  themeToggle.addEventListener('click', function () {
    const newTheme = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    setIcon(newTheme);
  });
})();
