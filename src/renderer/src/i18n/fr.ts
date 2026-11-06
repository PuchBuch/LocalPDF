import type { Messages } from './ru'

const countSuffix = (count: number) => (count > 0 ? ` (${count})` : '')

export const fr: Messages = {
  appName: 'LocalPDF',
  language: 'Langue',
  ocrLanguage: 'Langue de la reconnaissance de texte',
  dialogs: {
    unsavedMessage: 'Enregistrer les modifications avant de fermer ?',
    unsavedDetail: 'Sinon, elles seront perdues.',
    save: 'Enregistrer',
    dontSave: 'Ne pas enregistrer',
    cancel: 'Annuler',
    incomingMessage: 'Ouvrir {names} ?',
    incomingDetail: 'Un autre document est ouvert.',
    add: 'Ajouter au document',
    replace: 'Ouvrir à la place',
    filesFilter: 'PDF et images'
  },
  selectFile: 'Choisir un fichier',
  dropHint: 'ou déposez ici un PDF ou une image',
  dropOverlay: 'Relâchez le fichier pour l’ajouter',
  opening: 'Ouverture du fichier…',
  newFile: 'Nouveau fichier',
  download: 'Télécharger',
  saving: 'Veuillez patienter…',
  savedAs: (name) => `Enregistré : ${name}`,
  saveFailed:
    'Le fichier n’a pas pu être enregistré. Il est peut-être ouvert dans un autre programme. Essayez un autre nom ou un autre dossier.',
  moreOptions: 'Autres sorties',
  print: 'Imprimer',
  printFailed: 'Le document n’a pas pu être envoyé à l’imprimante.',
  copyMarkdown: 'Copier le texte en Markdown',
  saveMarkdown: 'Enregistrer le texte en Markdown',
  extractFailed: 'Le texte du document n’a pas pu être extrait.',
  copied: 'Texte copié dans le presse-papiers',
  password: {
    title: 'Ce document est protégé par un mot de passe',
    placeholder: 'Mot de passe',
    wrong: 'Mot de passe incorrect. Veuillez réessayer.',
    keep: 'Conserver le mot de passe',
    keepOn: 'Le fichier enregistré restera protégé par ce mot de passe',
    keepOff: 'Le fichier enregistré ne sera pas protégé',
    unlock: 'Ouvrir',
    cancel: 'Annuler'
  },
  thumbnailMenu: {
    copyContent: 'Copier le texte',
    recognize: 'Reconnaître le texte',
    findFields: 'Trouver les champs',
    thisPage: 'Cette page',
    allPages: 'Toutes les pages',
    clearFields: (count) => (count === 1 ? 'Vider le champ (1)' : `Vider les champs${countSuffix(count)}`),
    deleteFields: (count) => (count === 1 ? 'Supprimer le champ (1)' : `Supprimer les champs${countSuffix(count)}`)
  },
  textLeftInFile: (pages) =>
    `Attention : à la page ${pages}, le texte remplacé n’a pas pu être entièrement retiré du fichier. Il n’est pas visible, mais des logiciels peuvent le retrouver.`,
  imageLeftInFile: (pages) =>
    `Attention : à la page ${pages}, une image se trouve sous le texte remplacé. Elle est masquée mais reste dans le fichier, et son contenu peut en être extrait.`,
  ocr: {
    starting: 'Démarrage de la reconnaissance de texte…',
    progress: (page, total) => `Reconnaissance de la page ${page} sur ${total}…`,
    done: (words) => `Mots reconnus : ${words}`,
    nothingToRead: 'Ces pages contiennent déjà du texte, rien à reconnaître',
    noWords: 'Aucun texte trouvé. Le scan est peut-être trop pâle, ou la page ne contient pas de texte.',
    failed: 'Le texte n’a pas pu être reconnu.'
  },
  detect: {
    found: (count) => `Champs trouvés : ${count}`,
    none: 'Aucun champ à remplir n’a été trouvé',
    failed: 'La recherche des champs a échoué.'
  },
  formNotPrinted: 'Attention : le formulaire de ce fichier n’a pas pu être intégré aux pages, les valeurs saisies n’ont donc pas été enregistrées. Essayez de les saisir comme du texte ordinaire.',
  moveHint: 'Maintenez Maj pour désactiver l’alignement',
  editScope: { line: 'Ligne', word: 'Mot', label: 'Que modifier' },
  font: {
    title: 'Police',
    family: 'Police de caractères',
    bold: 'Gras',
    italic: 'Italique',
    color: 'Couleur du texte',
    boldIcon: 'G',
    italicIcon: 'I',
    families: { arial: 'Arial', times: 'Times New Roman', calibri: 'Calibri', courier: 'Courier New' }
  },
  recovery: {
    title: 'Un document non enregistré a été trouvé',
    details: (names, time) => `${names}. Dernière modification : ${time}.`,
    restore: 'Restaurer',
    discard: 'Supprimer',
    failed: 'Le document n’a pas pu être restauré.'
  },
  missingCharacters: (characters) => `Les caractères absents de la police n’ont pas été repris : ${characters}`,
  zoomIn: 'Agrandir',
  zoomOut: 'Réduire',
  close: 'Fermer',
  undo: 'Annuler',
  redo: 'Rétablir',
  addPages: 'Ajouter des pages',
  deletePage: 'Supprimer la page',
  rotatePage: 'Pivoter dans le sens horaire',
  movePageUp: 'Monter',
  movePageDown: 'Descendre',
  tools: {
    cursor: { label: 'Curseur', hint: 'Curseur : sélectionnez le texte et les champs du document' },
    edit: { label: 'Modifier le texte', hint: 'Modifier le texte : cliquez sur une ligne ou un mot du document et modifiez-le' },
    text: { label: 'Texte', hint: 'Texte : cliquez sur la page pour ajouter un champ' },
    checkbox: { label: 'Marque', hint: 'Marque : cliquez sur la page, puis choisissez une coche, une croix ou un point' },
    signature: { label: 'Signature', hint: 'Signature : cliquez sur la page pour ajouter un champ' },
    picture: { label: 'Image', hint: 'Image : cliquez sur la page pour ajouter un champ' },
    comb: { label: 'Texte en cases', hint: 'Texte en cases : cliquez sur la page pour ajouter un champ' }
  },
  signature: {
    title: 'Signature',
    tabDraw: 'Dessiner',
    tabType: 'Saisir',
    clear: 'Effacer',
    finish: 'Terminé',
    namePlaceholder: 'Saisissez un nom'
  },
  choosePicture: 'Choisir une image',
  pictureUnsupported: (name) => `« ${name} » n’a pas été ajouté : ce champ accepte JPEG, PNG, WebP et GIF.`,
  spacingSmaller: 'Cases plus étroites',
  spacingLarger: 'Cases plus larges',
  resizeHint: 'Maintenez Maj pour libérer les proportions',
  fieldCopy: 'Copier le champ',
  fieldDelete: 'Supprimer le champ',
  fieldMove: 'Déplacer le champ',
  fieldBackground: 'Fond : transparent ou blanc',
  fontSmaller: 'Réduire la police',
  fontLarger: 'Agrandir la police',
  checkbox: 'Coche',
  checkboxMarks: { tick: 'Coche', cross: 'Croix', dot: 'Point' },
  pasteHint: 'Cliquez sur une page pour coller le champ. Échap pour annuler',
  pageOf: (page, total) => `Page ${page} sur ${total}`,
  zoomPercent: (zoom) => `${Math.round(zoom * 100)} %`,
  goToPage: (page) => `Aller à la page ${page}`,
  fileUnreadable: (name) => `« ${name} » n’a pas pu être ouvert. Le fichier est endommagé ou son format n’est pas pris en charge.`,
  filePassword: (name) => `La protection de « ${name} » n’a pas pu être retirée.`,
  fileHeic: (name) => `« ${name} » n’a pas été ouvert : le format HEIC n’est pas encore pris en charge. Enregistrez la photo en JPEG.`,
  fileUnsupported: (name) => `« ${name} » n’a pas été ouvert : PDF, JPEG, PNG, WebP et GIF sont pris en charge.`
}
