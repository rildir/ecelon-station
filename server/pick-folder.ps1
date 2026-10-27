# Modern Windows klasör seçici (Gezgin görünümü: hızlı erişim, son kullanılanlar, adres çubuğu).
# IFileOpenDialog + FOS_PICKFOLDERS. Olmazsa eski klasör penceresine düşer.
param([string]$Start = "")
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$code = @"
using System;
using System.Runtime.InteropServices;
public static class EcelonPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] private class FileOpenDialogRCW { }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid([MarshalAs(UnmanagedType.LPStruct)] Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem ppv);
  public static string Pick(IntPtr owner, string title, string ok, string start) {
    IFileDialog d = (IFileDialog)new FileOpenDialogRCW();
    uint o; d.GetOptions(out o);
    d.SetOptions(o | 0x20 | 0x40 | 0x800); // PICKFOLDERS | FORCEFILESYSTEM | PATHMUSTEXIST
    d.SetTitle(title); d.SetOkButtonLabel(ok);
    if (!string.IsNullOrEmpty(start)) {
      try { IShellItem f; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out f); d.SetFolder(f); } catch { }
    }
    if (d.Show(owner) != 0) return null; // iptal
    IShellItem r; d.GetResult(out r);
    string p; r.GetDisplayName(0x80058000, out p); // SIGDN_FILESYSPATH
    return p;
  }
}
"@
# Pencere tarayıcının arkasında kalmasın: görünmez, en üstte duran bir sahip pencere
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; FormBorderStyle = 'None'; Opacity = 0; Width = 1; Height = 1; StartPosition = 'CenterScreen' }
$owner.Show(); $owner.Activate()
try {
  Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop
  $p = [EcelonPicker]::Pick($owner.Handle, 'Ajanın çalışacağı proje klasörünü seç', 'Bu klasörü seç', $Start)
  if ($p) { [Console]::Out.Write($p) }
} catch {
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = 'Ajanın çalışacağı proje klasörünü seç'
  if ($Start) { $d.SelectedPath = $Start }
  if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
} finally { $owner.Close() }
