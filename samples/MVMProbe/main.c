/* Compiled as a macOS x86_64 Mach-O with Zig/Clang. No Apple SDK is copied.
 * These public ABI declarations let this sample exercise actual imported calls.
 */
typedef void *id;
typedef void *SEL;
extern id objc_getClass(const char *);
extern SEL sel_registerName(const char *);
extern id objc_msgSend(id, SEL, ...);
extern int puts(const char *);
extern int open(const char *, int, ...);
extern long read(int, void *, unsigned long);
extern int close(int);
extern char NSApplicationLoad(void);

static id text(const char *s) {
  return objc_msgSend(objc_getClass("NSString"),sel_registerName("stringWithUTF8String:"),s);
}
static int sum(int count) {
  int result = 0;
  for (int i = 1; i <= count; ++i) result += i;
  return result;
}
int main(void) {
  puts("MVM Probe: compiled macOS application running on Windows.");
  if (sum(10) != 55) return 10;
  puts("Functions, branches, stack variables and arithmetic: OK");
  char buffer[512];
  int fd = open("Contents/Resources/message.txt",0);
  if (fd < 0) return 11;
  long size = read(fd,buffer,sizeof(buffer)-1);
  close(fd);
  if (size < 0) return 12;
  buffer[size] = 0;
  puts(buffer);
  if (!NSApplicationLoad()) return 13;
  id alert = objc_msgSend(objc_getClass("NSAlert"),sel_registerName("alloc"));
  alert = objc_msgSend(alert,sel_registerName("init"));
  objc_msgSend(alert,sel_registerName("setMessageText:"),text("MVM Probe - macOS application on Windows"));
  objc_msgSend(alert,sel_registerName("setInformativeText:"),text(buffer));
  objc_msgSend(alert,sel_registerName("addButtonWithTitle:"),text("Continue"));
  objc_msgSend(alert,sel_registerName("runModal"));
  objc_msgSend(alert,sel_registerName("release"));
  puts("NSAlert host bridge completed.");
  return 42;
}
