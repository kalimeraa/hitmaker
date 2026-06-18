const FIRST_NAMES = [
  "Ahmet", "Mehmet", "Ayse", "Fatma", "Emre", "Deniz", "Selin", "Burak", "Elif", "Can",
  "John", "Emma", "Liam", "Olivia", "Noah", "Sophia", "James", "Mia", "Lucas", "Ella"
];

const LAST_NAMES = [
  "Yilmaz", "Kaya", "Demir", "Celik", "Sahin", "Ozturk", "Arslan", "Dogan", "Aydin", "Koc",
  "Smith", "Johnson", "Brown", "Taylor", "Wilson", "Miller", "Davis", "Moore", "Clark", "Lee"
];

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12);
}

function generatePassword(length = randomInt(12, 16)) {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const special = "!@#$%&*";
  const all = lower + upper + digits + special;
  const chars = [
    randomItem(lower.split("")),
    randomItem(upper.split("")),
    randomItem(digits.split("")),
    randomItem(special.split(""))
  ];
  while (chars.length < length) {
    chars.push(randomItem(all.split("")));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function generateBirthday(minYear = 1985, maxYear = 2002) {
  return {
    day: randomInt(1, 28),
    month: randomInt(1, 12),
    year: randomInt(minYear, maxYear)
  };
}

function generateUsername({ firstName, lastName, attempt = 0 } = {}) {
  const first = slugify(firstName) || "user";
  const last = slugify(lastName) || "mail";
  const suffix = randomInt(10000, 99999) + attempt * 137;
  return `${first}.${last}${suffix}`.slice(0, 30);
}

function generateSignupIdentity(options = {}) {
  const firstName = options.firstName || randomItem(FIRST_NAMES);
  const lastName = options.lastName || randomItem(LAST_NAMES);
  const birthday = options.birthday || generateBirthday();
  const password = options.password || generatePassword();
  const username = options.username || generateUsername({ firstName, lastName, attempt: 0 });
  const email = `${username}@gmail.com`;

  return {
    firstName,
    lastName,
    birthday,
    password,
    username,
    email
  };
}

module.exports = {
  generateSignupIdentity,
  generatePassword,
  generateUsername,
  generateBirthday,
  slugify
};
