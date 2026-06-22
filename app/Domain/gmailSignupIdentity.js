const FIRST_NAMES = [
  "Ahmet", "Mehmet", "Mustafa", "Ali", "Huseyin", "Hasan", "Murat", "Emre", "Burak", "Can",
  "Kaan", "Onur", "Kerem", "Yusuf", "Omer", "Deniz", "Eren", "Berk", "Baris", "Serkan",
  "Furkan", "Enes", "Muhammed", "Ibrahim", "Ismail", "Mert", "Alperen", "Tolga", "Umut", "Cem",
  "Cemal", "Cihan", "Volkan", "Koray", "Cagatay", "Taha", "Arda", "Oguz", "Oguzhan", "Ugur",
  "Halil", "Kadir", "Sinan", "Levent", "Tayfun", "Erkan", "Erdem", "Ersin", "Bora", "Alp",
  "Alper", "Bulent", "Hakan", "Metin", "Selcuk", "Orhan", "Kemal", "Cenk", "Yigit", "Sercan",
  "Gokhan", "Ilker", "Mete", "Mertcan", "Batuhan", "Bartu", "Doruk", "Atakan", "Yasin", "Adem",
  "Ayse", "Fatma", "Elif", "Zeynep", "Merve", "Selin", "Derya", "Ece", "Buse", "Gizem",
  "Esra", "Ceren", "Seda", "Melis", "Irem", "Sibel", "Aylin", "Asli", "Yasemin", "Damla",
  "Hatice", "Emine", "Havva", "Sultan", "Esma", "Rabia", "Kubra", "Nisa", "Nazli", "Eylul",
  "Dila", "Dilan", "Dilara", "Berfin", "Beyza", "Busra", "Gamze", "Gul", "Gulcan", "Gulsum",
  "Sevgi", "Sevda", "Melek", "Mina", "Nehir", "Nisan", "Derin", "Ilayda", "Alara", "Ela",
  "Defne", "Azra", "Sude", "Beste", "Tugce", "Burcu", "Pelin", "Pinar", "Sevil", "Nur",
  "Nurgul", "Nuray", "Neslihan", "Ebru", "Muge", "Hande", "Bahar", "Cigdem", "Ozge", "Cansu"
];

const LAST_NAMES = [
  "Yilmaz", "Kaya", "Demir", "Celik", "Sahin", "Ozturk", "Arslan", "Dogan", "Aydin", "Koc",
  "Ozdemir", "Polat", "Kilic", "Aslan", "Turan", "Yildiz", "Yalcin", "Acar", "Bulut", "Kaplan",
  "Erdogan", "Korkmaz", "Keskin", "Avci", "Tas", "Gunes", "Bozkurt", "Uysal", "Kurt", "Simsek",
  "Cetin", "Aksoy", "Tekin", "Karaca", "Yavuz", "Guler", "Eren", "Sari", "Kara", "Akbas",
  "Akkaya", "Akgun", "Aksu", "Alkan", "Altun", "Ates", "Ay", "Ayhan", "Balci", "Basaran",
  "Baskan", "Bayrak", "Bayraktar", "Baysal", "Bilgin", "Can", "Canpolat", "Cavus", "Coban", "Cakmak",
  "Dag", "Demirci", "Dincer", "Durmaz", "Dursun", "Ekici", "Er", "Ergin", "Eroglu", "Genc",
  "Gok", "Gokce", "Gungor", "Gurbuz", "Guzel", "Isik", "Kalkan", "Karaaslan", "Karadag", "Karahan",
  "Karatas", "Kayaalp", "Kocak", "Kose", "Kucuk", "Mert", "Mutlu", "Ocal", "Onal", "Orhan",
  "Ozcan", "Ozkan", "Ozer", "Pek", "Savas", "Sezer", "Solmaz", "Sonmez", "Soylu", "Tan",
  "Topal", "Toprak", "Ucar", "Ulusoy", "Unal", "Uzun", "Yaman", "Yasar", "Yazici", "Yesil"
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

function generateBirthday(minYear = 1970, maxYear = 2000) {
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
