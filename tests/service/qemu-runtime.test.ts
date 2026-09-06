import { describe, expect, test } from 'vitest';
import { cloudConfig, guestLaunchScript, qemuArguments, QemuRuntime, shQuote } from '../../electron/qemu-runtime.js';

describe('QEMU backend configuration',()=>{
  test('provisions a Linux guest using cloud-init with pinned Darling integrity',()=>{
    const config=JSON.parse(cloudConfig('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample mvm').replace('#cloud-config\n',''));
    expect(config.ssh_pwauth).toBe(false);
    expect(config.disable_root).toBe(true);
    expect(config.users[0].name).toBe('mvm');
    expect(config.users[0].sudo).toBeUndefined();
    const script=config.write_files[0].content as string;
    expect(script).toContain('sha256sum -c -');
    expect(script).toContain('test "$VERSION_ID" = 24.04');
    expect(script).toContain('/var/lib/mvm-darling-ready');
    expect(script).not.toContain('wsl.exe');
    expect(script.indexOf('sha256sum -c -')).toBeLessThan(script.indexOf('unzip -o'));
    expect(script.indexOf('systemctl restart lightdm')).toBeGreaterThan(script.indexOf('autologin-user=mvm'));
    expect(config.ssh_deletekeys).toBe(false);
    expect(config.write_files[1].content).toContain('Restart=on-failure');
    expect(config.write_files[1].content).toContain('ConditionPathExists=!/var/lib/mvm-darling-ready');
  });
  test('rejects extra cloud-init directives in a public key',()=>{
    expect(()=>cloudConfig('ssh-ed25519 AAAA\nruncmd: []')).toThrow('Invalid SSH');
  });
  test('uses stock TCG and loopback-only SSH forwarding without host drive sharing',()=>{
    const args=qemuArguments('D:\\MVM, Data\\mvm.qcow2',2222,8888,'a1-b2','D:\\MVM\\serial.log');
    expect(args).toContain('tcg,thread=multi');
    expect(args).toContain('file=D:\\MVM,, Data\\mvm.qcow2,format=qcow2,if=virtio');
    expect(args).toContain('user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:2222-:22');
    expect(args.join(' ')).not.toMatch(/wsl|virtfs|smb=|host_device/);
    expect(()=>qemuArguments('disk',22,8888,'token','log')).toThrow();
  });
  test('quotes guest paths without remote shell injection',()=>{
    expect(shQuote("A'$(touch bad).app")).toBe("'A'\\''$(touch bad).app'");
  });
  test('never claims execution when a VM is not ready',async()=>{
    const runtime=new QemuRuntime('D:\\unused-qemu-test','7z.exe');
    expect(runtime.status()).toMatchObject({phase:'offline',running:false});
    expect(await runtime.run('D:\\Example.app','Example')).toMatchObject({status:'blocked'});
  });
  test('launches from the bundle directory so relative resource paths resolve',()=>{
    const script=guestLaunchScript('/Volumes/SystemRoot/home/mvm/inbox/test/MVMImported.app','MVM Probe');
    expect(script).toContain("cd -- '/Volumes/SystemRoot/home/mvm/inbox/test/MVMImported.app'");
    expect(script).toContain("exec './Contents/MacOS/MVM Probe'");
    expect(()=>guestLaunchScript('/wrong','../bad')).toThrow();
  });
});
