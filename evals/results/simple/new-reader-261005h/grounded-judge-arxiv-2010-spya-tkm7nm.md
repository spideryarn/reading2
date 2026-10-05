blind-id: eb39669bcd2a

Main findings

1. The method: a standard Transformer, changed as little as possible, is applied directly to an image cut into fixed-size patches that are linearly embedded and treated like word tokens (with position embeddings and a class token); reliance on CNNs is not necessary.
2. ViT has much less image-specific inductive bias than CNNs, and when trained on a mid-sized dataset such as ImageNet it lands a few percentage points below ResNets of comparable size.
3. The picture reverses with large pre-training sets (ImageNet-21k at 14M, JFT-300M at 303M): ViT overtakes the ResNets, larger ViTs only pay off with more data, and on JFT subsets ViT is worse at 9M but better from 90M up; large-scale training trumps inductive bias.
4. Headline results: the best model (ViT-H/14 on JFT-300M) reaches 88.55% on ImageNet, 94.55% on CIFAR-100 and 77.63% on the 19-task VTAB suite, matching or beating the state-of-the-art CNNs (BiT-L, Noisy Student).
5. ViT is substantially cheaper to pre-train (2.5k or 0.68k TPUv3-core-days against 9.9k and 12.3k), and a controlled scaling study finds about 2 to 4 times less compute for the same performance, with no saturation in the range tried; the authors caution that schedule, optimizer and weight decay also affect efficiency.
6. Hybrids (CNN feature maps fed to the Transformer) slightly outperform pure ViT at small compute budgets, but the difference vanishes for larger models.
7. Inspection of the model: learned position embeddings come to encode the 2D layout of the image, some attention heads attend across most of the image even in the lowest layers while others stay local, and attention distance grows with depth.
8. Preliminary self-supervised masked-patch pre-training gives ViT-B/16 79.9% on ImageNet, 2% above training from scratch but 4% behind supervised pre-training; detection, segmentation, self-supervision and further scaling remain open.

## G01

faults: 0

## G02

- bent: "On ImageNet-21k ... they roughly match" is said of ViT against ResNets, but the piece says ViT-Large and ViT-Base perform similarly there and that with the larger datasets ViT overtakes the BiT CNNs.
faults: 1

## G03

- omitted: finding 6, the hybrids that beat pure ViT at small compute budgets with the gap vanishing for larger models, is not mentioned at all.
- bent: "With ImageNet-21k (14 million images) the gap closes" is said of ViT against CNNs, but the piece says only that Large and Base ViTs become similar there and that with the larger datasets ViT overtakes.
faults: 2

## G04

faults: 0

## G05

- bent: "only with JFT-300M did ViT overtake" the ResNets, whereas the piece says ViT overtakes "with the larger datasets" and reserves "only with JFT-300M" for the full benefit of larger ViT models over smaller ones.
faults: 1

## G06

faults: 0

## G07

faults: 0
