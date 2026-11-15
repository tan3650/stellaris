"""Builds a SPHEREx-like MEF with astropy (independent writer) + reference WCS values for cross-checking lib/wcs.ts."""
import sys, json, numpy as np
from astropy.io import fits
from astropy.wcs import WCS
out = sys.argv[1]
w = WCS(naxis=2)
w.wcs.ctype = ["RA---TAN-SIP", "DEC--TAN-SIP"]
w.wcs.crval = [269.4463, 4.7679]
w.wcs.crpix = [41.3, 40.2]
th = np.deg2rad(37.0); s = 6.15/3600
w.wcs.cd = [[-s*np.cos(th), s*np.sin(th)], [s*np.sin(th), s*np.cos(th)]]
w.sip = __import__("astropy.wcs", fromlist=["Sip"]).Sip(
    np.array([[0,0,1e-5],[0,2e-5,0],[3e-6,0,0]]), np.array([[0,0,0],[1e-5,1e-5,0],[0,0,0]]), None, None, w.wcs.crpix)
h = w.to_header(relax=True)
n = 80
yy, xx = np.mgrid[0:n, 0:n]
img = (np.exp(-((xx-30)**2+(yy-50)**2)/8.0)*10 + 0.5).astype("f4")
img[5,5] = np.nan
flags = np.zeros((n,n), dtype="u4"); flags[10,10] = 1<<10; flags[20,20] = 1<<19; flags[30,30] = 1<<21
fh = fits.Header(); 
for b,nm in [(0,"TRANSIENT"),(10,"HOT"),(11,"COLD"),(19,"OUTLIER"),(21,"SOURCE")]:
    fh["MSKN%d"%b]=nm; fh["MSKD%d"%b]="desc"
ih = h.copy(); ih["BUNIT"]="MJy / sr"; ih["DETECTOR"]=4; ih["LTV1"]=-100.0; ih["LTV2"]=-200.0
prim = fits.PrimaryHDU(); prim.header["VERSION"]="v27"
# WCS-WAVE lookup table: grid of control points over original pixel coords (cutout x = orig x + LTV1)
X = np.linspace(0, 2040, 9).astype("f4"); Y = np.linspace(0, 2040, 9).astype("f4")
VAL = np.zeros((9, 9, 2), dtype="f4")   # numpy (ny,nx,2) == FITS (2,nx,ny)
for j in range(9):
    for i in range(9):
        VAL[j,i,0] = 2.42 + 1.40*(i/8.0)   # central wavelength 2.42-3.82 um across x
        VAL[j,i,1] = 0.08
col = [fits.Column(name="X", format="9E", array=X[None,:]),
       fits.Column(name="Y", format="9E", array=Y[None,:]),
       fits.Column(name="VALUES", format="162E", array=VAL.reshape(1,-1))]
tb = fits.BinTableHDU.from_columns(col, name="WCS-WAVE")
fits.HDUList([prim, fits.ImageHDU(img, ih, name="IMAGE"), fits.ImageHDU(flags, fh, name="FLAGS"),
              fits.ImageHDU(np.ones((n,n),dtype="f4"), name="VARIANCE"), fits.ImageHDU(np.ones((n,n),dtype="f4"), name="ZODI"), tb]).writeto(out, overwrite=True)
ref = []
for (x,y) in [(0,0),(40,40),(79,79),(10,70),(65,12)]:
    ra,dec = w.all_pix2world(x,y,0); ref.append([x,y,float(ra),float(dec)])
ra,dec = 269.4470, 4.7690
px = w.all_world2pix(ra,dec,0)
json.dump({"pix2sky":ref, "sky2pix":[ra,dec,float(px[0]),float(px[1])]}, open(out+".json","w"))
print("ok")
